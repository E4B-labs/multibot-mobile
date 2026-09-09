package expo.modules.multibottor

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Codes the JS side switches on. Never match on the message text. */
class MultibotTorException(code: String, message: String, cause: Throwable? = null) :
  CodedException(code, message, cause)

/**
 * The phone's embedded Tor client, so a MultiBot server with no public address
 * can still be reached at the onion address it publishes.
 *
 * Two things come out of a successful [start]:
 *   * **socksPort** — Tor's own SOCKS5 listener. `modules/multibot-tls` points
 *     React Native's `fetch` and the certificate probe at it, and the JDK gives
 *     a SOCKS route an unresolved address, so the `.onion` name is resolved by
 *     the circuit and never by the phone.
 *   * **bridgePort** — the HTTP-CONNECT server below, for the WebView. Android's
 *     `ProxyController` documents HTTP proxies; SOCKS in a `ProxyConfig` is not
 *     documented to work, so we do not bet the whole feature on it. The bridge's
 *     own upstream is another `Socket(Proxy(SOCKS, …))`, which means not one
 *     byte of the SOCKS protocol is written by hand anywhere in this module.
 *
 * We deliberately do NOT use `org.torproject.jni.TorService` from the AAR: it
 * owns its own torrc, its own data directory and its own lifecycle. All we want
 * from the dependency is the packaged, executable `libtor.so` — on API 29+ an
 * app may not exec from its data directory, and `jniLibs` is the one place a
 * binary is still allowed to run from. Everything above that is ours.
 */
object MultibotTor {
  const val TAG = "MultibotTor"

  /** The AAR packs tor as a native library so it lands in `nativeLibraryDir`
   * with the execute bit and stays exempt from W^X. Name is fixed by the AAR. */
  private const val TOR_LIB = "libtor.so"

  /** Both spellings tor has used for this line; the port is what matters. */
  private val SOCKS_LINE = Regex("""Opened Socks listener.*?on 127\.0\.0\.1:(\d{1,5})""")
  private val BOOTSTRAPPED = "Bootstrapped 100%"

  /** Exactly what `isOnionHost` in src/lib/host-logic.ts accepts: a v3 address,
   * 56 base32 characters. The bridge refuses everything else, so a WebView
   * pointed at it can never be used to reach an ordinary host. */
  private val ONION = Regex("""^[a-z2-7]{56}\.onion$""")

  private var process: Process? = null
  private var bridge: Bridge? = null

  @Volatile
  private var socksPort: Int = 0

  @Volatile
  private var bootstrapped: Boolean = false

  private fun alive(): Boolean = process?.isAlive == true

  @Synchronized
  fun status(): Map<String, Any> = mapOf(
    "running" to alive(),
    "bootstrapped" to (alive() && bootstrapped),
    "socksPort" to if (alive()) socksPort else 0,
    "bridgePort" to (bridge?.port ?: 0),
  )

  /**
   * Starts tor (or returns the ports of the one already running) and comes back
   * as soon as its SOCKS listener is open — NOT when it has bootstrapped to
   * 100%. Tor holds a SOCKS stream "unattached waiting for an appropriate
   * circuit" (SocksTimeout, 2 minutes by default), so the first request through
   * the bridge still lands; it simply no longer costs an empty screen.
   *
   * Waiting for the bootstrap here put every later step of a cold start —
   * starting the WebView engine, parsing the bundled UI, running its own boot —
   * AFTER the circuit instead of alongside it, which is most of why opening the
   * app on mobile data felt hung.
   *
   * Synchronized: two screens asking at once must get one tor, not two fighting
   * over one data directory.
   */
  @Synchronized
  fun start(context: Context, timeoutMs: Int): Map<String, Any> {
    val running = bridge
    // Deliberately NOT `bootstrapped`: now that start() returns early, a second
    // caller arriving mid-bootstrap would otherwise fall through to stop() and
    // kill the very tor the first caller is waiting on.
    if (alive() && socksPort > 0 && running != null && running.open) {
      return mapOf("socksPort" to socksPort, "bridgePort" to running.port)
    }
    stop()

    val app = context.applicationContext
    val binary = File(app.applicationInfo.nativeLibraryDir, TOR_LIB)
    if (!binary.canExecute()) {
      throw MultibotTorException(
        "unavailable",
        "This build has no Tor binary for this device, so .onion addresses cannot be reached.",
      )
    }

    val dataDir = File(app.filesDir, "tor")
    if (!dataDir.isDirectory && !dataDir.mkdirs()) {
      throw MultibotTorException("unavailable", "Could not create Tor's data directory.")
    }
    // Tor refuses to start when its data directory is group- or world-readable.
    dataDir.setReadable(false, false)
    dataDir.setWritable(false, false)
    dataDir.setExecutable(false, false)
    dataDir.setReadable(true, true)
    dataDir.setWritable(true, true)
    dataDir.setExecutable(true, true)

    // Rewritten every start: whatever a previous version wrote is not what this
    // version means, and there is nothing in here worth preserving.
    // No AvoidDiskWrites: it is tor's "write to disk less frequently" switch
    // (upstream default 0) and it defers writing the state file, entry guards
    // among it. This process lives for as long as Android lets the app stay
    // open and is then killed, so the deferred write never happens and every
    // cold start picks its guards from scratch. Flash wear is not a real
    // concern for a client opened a handful of times a day.
    // ponytail: no GeoIPFile — the AAR keeps geoip inside the APK's assets and
    // unpacking it only buys country statistics we never read. Tor logs one
    // notice about it and works. Add it when someone wants ExitNodes rules.
    val torrc = File(dataDir, "torrc")
    torrc.writeText(
      """
      # generated by modules/multibot-tor — edits are overwritten
      DataDirectory ${dataDir.absolutePath}
      SocksPort auto
      ClientOnly 1
      Log notice stdout
      """.trimIndent() + "\n",
    )

    val socksReady = CountDownLatch(1)
    bootstrapped = false
    socksPort = 0

    val started = try {
      ProcessBuilder(binary.absolutePath, "-f", torrc.absolutePath)
        .directory(dataDir)
        .redirectErrorStream(true)
        .also { it.environment()["HOME"] = dataDir.absolutePath }
        .start()
    } catch (failure: IOException) {
      throw MultibotTorException("unavailable", failure.message ?: "Could not start Tor.", failure)
    }
    process = started

    // One reader for the whole life of the process: it is both how we learn the
    // SOCKS port and the only thing keeping tor's stdout pipe from filling up
    // and wedging the process a few hundred log lines later.
    thread(name = "multibot-tor-log", isDaemon = true) {
      try {
        started.inputStream.bufferedReader().forEachLine { line ->
          if (socksPort == 0) {
            SOCKS_LINE.find(line)?.groupValues?.get(1)?.toIntOrNull()?.let {
              socksPort = it
              socksReady.countDown()
            }
          }
          if (line.contains(BOOTSTRAPPED)) bootstrapped = true
        }
      } catch (closed: IOException) {
        Log.w(TAG, "tor's output ended", closed)
      } finally {
        // The process died; nobody may keep waiting on a latch that will never
        // be counted down by a log line.
        bootstrapped = false
        socksReady.countDown()
      }
    }

    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs.toLong())
    awaitOrDie(socksReady, deadline, "Tor did not open its SOCKS port in time.")
    if (socksPort <= 0) {
      stop()
      throw MultibotTorException("timeout", "Tor stopped before it finished starting.")
    }

    val opened = Bridge(socksPort)
    bridge = opened
    Log.i(TAG, "tor is listening: socks=$socksPort bridge=${opened.port} (circuit still building)")
    return mapOf("socksPort" to socksPort, "bridgePort" to opened.port)
  }

  private fun awaitOrDie(latch: CountDownLatch, deadlineNanos: Long, message: String) {
    val left = deadlineNanos - System.nanoTime()
    val reached = left > 0 && try {
      latch.await(left, TimeUnit.NANOSECONDS)
    } catch (interrupted: InterruptedException) {
      Thread.currentThread().interrupt()
      false
    }
    if (!reached) {
      stop()
      throw MultibotTorException("timeout", message)
    }
  }

  /** Kills tor and closes the bridge. Safe to call when nothing is running. */
  @Synchronized
  fun stop() {
    bridge?.let {
      bridge = null
      it.close()
    }
    process?.let { running ->
      process = null
      running.destroy()
      // A tor that ignores SIGTERM would otherwise outlive the app and keep its
      // data directory locked, so the next start could never succeed.
      if (!running.waitFor(3, TimeUnit.SECONDS)) running.destroyForcibly()
    }
    socksPort = 0
    bootstrapped = false
  }

  // --- WebView proxy --------------------------------------------------------

  private val direct = Executor { it.run() }

  private val main = Handler(Looper.getMainLooper())

  /**
   * Runs one ProxyController call on the main thread, with the WebView engine
   * guaranteed to be running first.
   *
   * Both are load-bearing. `ProxyController` is a thin shim over the WebView
   * that the process has already started, and off the main thread it hands the
   * work to Chromium's run queue and blocks — which Chromium refuses to do
   * before its browser process is up, with a bare
   * `RuntimeException("Must be started before we block!")`. Every one of these
   * calls happens while the first host is being opened, which is before
   * anything has ever built a WebView, so on a cold start the queue is empty
   * and the call throws. Constructing a WebView (and immediately throwing it
   * away) is the documented way to start the engine, it may only be done on the
   * main thread, and it costs nothing once the engine is already up.
   */
  private fun onWebViewEngine(context: Context, whenFailed: String, done: (MultibotTorException?) -> Unit, work: () -> Unit) {
    main.post {
      try {
        WebView(context).destroy()
        work()
      } catch (failure: Exception) {
        done(MultibotTorException("unavailable", failure.message ?: whenFailed, failure))
      }
    }
  }

  /**
   * Sends every WebView request through the bridge. Process-wide by design:
   * there is one WebView in this app, and while it is showing an onion host
   * nothing else may leave it. [clearWebViewProxy] puts it back.
   */
  fun setWebViewProxy(context: Context, bridgePort: Int, done: (MultibotTorException?) -> Unit) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
      done(
        MultibotTorException(
          "unavailable",
          "This device's WebView is too old to be pointed at Tor. Update Android System WebView.",
        ),
      )
      return
    }
    onWebViewEngine(context, "Could not route the WebView through Tor.", done) {
      val config = ProxyConfig.Builder().addProxyRule("http://127.0.0.1:$bridgePort").build()
      ProxyController.getInstance().setProxyOverride(config, direct) { done(null) }
    }
  }

  fun clearWebViewProxy(context: Context, done: (MultibotTorException?) -> Unit) {
    // Not supported means nothing was ever set, so there is nothing to undo.
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
      done(null)
      return
    }
    onWebViewEngine(context, "Could not take the WebView off Tor.", done) {
      ProxyController.getInstance().clearProxyOverride(direct) { done(null) }
    }
  }

  // --- HTTP CONNECT bridge --------------------------------------------------

  /**
   * A one-purpose HTTP proxy: it accepts `CONNECT <onion>:<port>` from loopback
   * and nothing else, then hands the socket to Tor and copies bytes.
   *
   * Because it only ever copies raw bytes after the CONNECT, the WebView's own
   * TLS handshake reaches the MultiBot server untouched — the self-signed
   * certificate and the trust-on-first-use pin in `plugins/with-tls-pinning.js`
   * work exactly as they do on a LAN address.
   */
  private class Bridge(private val socksPort: Int) {
    // IPv4 on both ends: the WebView proxy rule below points at 127.0.0.1, and
    // Tor's SOCKS listener is IPv4-only, while getLoopbackAddress() gives ::1.
    private val server = ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"))
    private val pool = Executors.newCachedThreadPool()

    @Volatile
    var open: Boolean = true
      private set

    val port: Int get() = server.localPort

    init {
      thread(name = "multibot-tor-bridge", isDaemon = true) {
        while (open) {
          val client = try {
            server.accept()
          } catch (stopped: IOException) {
            break
          }
          // The socket is bound to loopback, so this cannot normally trip — it
          // is here because "only this phone may use the bridge" is a rule worth
          // stating twice rather than inferring from a bind argument.
          if (!client.inetAddress.isLoopbackAddress) {
            close(client)
            continue
          }
          try {
            pool.execute { serve(client) }
          } catch (saturated: Exception) {
            close(client)
          }
        }
      }
    }

    fun close() {
      open = false
      close(server)
      pool.shutdownNow()
    }

    private fun serve(client: Socket) {
      var upstream: Socket? = null
      // Once the 200 is out, the socket carries opaque TLS: writing an HTTP
      // error into it would corrupt the tunnel rather than explain anything.
      var tunnelled = false
      try {
        client.soTimeout = HANDSHAKE_TIMEOUT_MS
        val request = readHead(client.getInputStream())
          ?: return refuse(client, "400 Bad Request")
        val target = connectTarget(request)
          ?: return refuse(client, "403 Forbidden")

        // createUnresolved is the whole point: the name goes to Tor as a name.
        // Resolving it here would be both a DNS leak and a guaranteed failure.
        val out = Socket(Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", socksPort)))
        upstream = out
        out.connect(InetSocketAddress.createUnresolved(target.first, target.second), CONNECT_TIMEOUT_MS)

        client.getOutputStream().apply {
          write("HTTP/1.1 200 Connection established\r\n\r\n".toByteArray(Charsets.US_ASCII))
          flush()
        }
        // From here it is opaque TLS in both directions and neither side speaks
        // again in a timeframe we can guess at, so the read deadline comes off.
        tunnelled = true
        client.soTimeout = 0
        out.soTimeout = 0

        val upward = thread(name = "multibot-tor-pump", isDaemon = true) {
          pump(client.getInputStream(), out.getOutputStream())
          out.shutdownOutputQuietly()
        }
        pump(out.getInputStream(), client.getOutputStream())
        client.shutdownOutputQuietly()
        upward.join(PUMP_JOIN_MS)
      } catch (failure: Exception) {
        Log.w(TAG, "bridge connection failed", failure)
        if (!tunnelled) refuse(client, "502 Bad Gateway")
      } finally {
        close(upstream)
        close(client)
      }
    }

    /** Reads the request line and headers one byte at a time — a buffered
     * reader would swallow the first bytes of the tunnelled TLS handshake. */
    private fun readHead(input: InputStream): String? {
      val head = StringBuilder()
      while (head.length < MAX_HEAD_BYTES) {
        val byte = input.read()
        if (byte == -1) return null
        head.append(byte.toChar())
        if (head.endsWith("\r\n\r\n") || head.endsWith("\n\n")) return head.toString()
      }
      return null
    }

    /** `CONNECT <56-char v3 onion>:<port> HTTP/1.1` and literally nothing else.
     * Any other method, host or port is refused, so the bridge cannot be turned
     * into an open proxy or used to reach a clearnet address off the record. */
    private fun connectTarget(head: String): Pair<String, Int>? {
      val line = head.lineSequence().firstOrNull()?.trim() ?: return null
      val parts = line.split(' ')
      if (parts.size < 2 || !parts[0].equals("CONNECT", ignoreCase = true)) return null
      val authority = parts[1]
      val colon = authority.lastIndexOf(':')
      if (colon <= 0) return null
      val host = authority.substring(0, colon).lowercase(Locale.ROOT)
      val port = authority.substring(colon + 1).toIntOrNull() ?: return null
      if (port !in 1..65535 || !ONION.matches(host)) return null
      return host to port
    }

    private fun refuse(client: Socket, status: String) {
      try {
        client.getOutputStream().apply {
          write("HTTP/1.1 $status\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
          flush()
        }
      } catch (ignored: IOException) {
        Log.w(TAG, "could not answer a bridge client", ignored)
      }
    }

    private fun pump(from: InputStream, to: OutputStream) {
      val buffer = ByteArray(16 * 1024)
      try {
        while (true) {
          val read = from.read(buffer)
          if (read < 0) break
          to.write(buffer, 0, read)
          to.flush()
        }
      } catch (ended: IOException) {
        // Either side hanging up is the normal way a tunnel finishes.
      }
    }

    private fun Socket.shutdownOutputQuietly() {
      try {
        if (!isClosed && !isOutputShutdown) shutdownOutput()
      } catch (ignored: IOException) {
        Log.w(TAG, "could not half-close a bridge socket", ignored)
      }
    }

    private fun close(closeable: AutoCloseable?) {
      try {
        closeable?.close()
      } catch (ignored: Exception) {
        Log.w(TAG, "could not close a bridge socket", ignored)
      }
    }

    private companion object {
      const val HANDSHAKE_TIMEOUT_MS = 20_000
      const val CONNECT_TIMEOUT_MS = 60_000
      const val PUMP_JOIN_MS = 2_000L
      const val MAX_HEAD_BYTES = 8 * 1024
    }
  }
}
