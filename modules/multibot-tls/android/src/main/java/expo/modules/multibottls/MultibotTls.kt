package expo.modules.multibottls

import android.content.Context
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import expo.modules.kotlin.exception.CodedException
import okhttp3.Dns
import okhttp3.OkHttpClient
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.Socket
import java.net.SocketAddress
import java.net.URI
import java.net.UnknownHostException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Locale
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSession
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager

/** Codes the JS side switches on. Never match on the message text. */
class MultibotTlsException(code: String, message: String, cause: Throwable?) :
  CodedException(code, message, cause)

/**
 * Trust-on-first-use store for MultiBot's self-signed server certificates.
 *
 * A pin is scoped to one `host:port` and nothing else: a certificate pinned for
 * the phone's own server must never make some other host acceptable. The same
 * `SharedPreferences("multibot_tls")` file is read by the WebView SSL patch that
 * `plugins/with-tls-pinning.js` writes into react-native-webview — that patch
 * re-implements the lookup inline, because react-native-webview's Gradle module
 * cannot depend on this one, so the key format has to stay identical there, in
 * the ObjC patches, and in `src/lib/host-logic.ts`.
 */
object MultibotTls {
  const val TAG = "MultibotTls"
  private const val PREFS = "multibot_tls"

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  /** Lowercase host without IPv6 brackets, a colon, and the port (443 default). */
  fun keyFor(host: String, port: Int): String {
    val bare = host.trim('[', ']').lowercase(Locale.ROOT)
    return "$bare:${if (port <= 0) 443 else port}"
  }

  fun pinned(context: Context, key: String): String? = prefs(context).getString(key, null)

  /** "trusted" on first sight, "unchanged" when it matches, "certificate_changed" otherwise. */
  fun trust(context: Context, key: String, fingerprint: String): String {
    val next = fingerprint.lowercase(Locale.ROOT)
    val existing = prefs(context).getString(key, null)
    return when {
      existing == null -> {
        prefs(context).edit().putString(key, next).apply()
        "trusted"
      }
      existing.equals(next, ignoreCase = true) -> "unchanged"
      else -> "certificate_changed"
    }
  }

  fun forget(context: Context, key: String) {
    prefs(context).edit().remove(key).apply()
  }

  /** SHA-256 of a downloaded file, so an APK can be checked before it is installed. */
  fun sha256File(path: String): String {
    val file = if (path.startsWith("file:")) File(URI(path)) else File(path)
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { stream ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = stream.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private val IPV4 = Regex("""^\d{1,3}(\.\d{1,3}){3}$""")

  private fun isIpLiteral(host: String): Boolean = host.contains(':') || IPV4.matches(host)

  fun isOnion(host: String): Boolean = host.endsWith(".onion", ignoreCase = true)

  /**
   * Where the embedded Tor client's SOCKS5 listener is, or 0 when it is not
   * running. Set from JavaScript once `MultibotTor.start()` has bootstrapped;
   * the OkHttp factory below is installed long before that, so the port has to
   * be read at request time rather than baked into the client.
   */
  @Volatile
  var torSocksPort: Int = 0
    private set

  fun setTorSocksPort(port: Int) {
    torSocksPort = if (port in 1..65535) port else 0
  }

  // Pinned to IPv4: getLoopbackAddress() answers ::1 on Android, and Tor's
  // `SocksPort auto` listens on 127.0.0.1 only — a ::1 dial is refused instantly.
  private fun socksProxy(port: Int): Proxy =
    Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", port))

  /**
   * Sends `.onion` requests to Tor and leaves everything else alone. The JDK
   * (and OkHttp) hand a SOCKS route an UNRESOLVED address, so the name is
   * resolved by the exit of the circuit and never by the phone.
   */
  private object OnionProxySelector : ProxySelector() {
    override fun select(uri: URI?): List<Proxy> {
      val host = uri?.host ?: return listOf(Proxy.NO_PROXY)
      val port = torSocksPort
      if (port <= 0 || !isOnion(host)) return listOf(Proxy.NO_PROXY)
      return listOf(socksProxy(port))
    }

    override fun connectFailed(uri: URI?, address: SocketAddress?, failure: IOException?) {
      Log.w(TAG, "could not reach $uri through $address", failure)
    }
  }

  /**
   * Fails closed on `.onion`: the system resolver must never see one, whether
   * Tor is down, the proxy selector was bypassed, or a redirect walked us onto
   * an onion host by surprise. A working onion request takes the SOCKS route
   * above and never asks this at all.
   */
  private object NoOnionDns : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
      if (isOnion(hostname)) {
        throw UnknownHostException("$hostname can only be reached through Tor.")
      }
      return Dns.SYSTEM.lookup(hostname)
    }
  }

  /**
   * Opens a TLS socket, reads the leaf certificate and hangs up. No HTTP request
   * is sent, so this learns a fingerprint without handing anything to a server
   * that has not been trusted yet.
   */
  fun probeFingerprint(url: String, timeoutMs: Int, socksPort: Int): String {
    val uri = try {
      URI(url)
    } catch (invalid: Exception) {
      throw MultibotTlsException("unreachable", "Not a valid address.", invalid)
    }
    val host = uri.host?.trim('[', ']')
      ?: throw MultibotTlsException("unreachable", "Not a valid address.", null)
    val port = if (uri.port == -1) 443 else uri.port
    // Fail closed rather than hand a `.onion` name to the system resolver: an
    // onion address without a SOCKS port is a bug, and the leak it would cause
    // (a DNS query naming the hidden service) is exactly what Tor is here for.
    if (isOnion(host) && socksPort <= 0) {
      throw MultibotTlsException("unreachable", "Tor is not running, so this address cannot be reached.", null)
    }

    val ssl = SSLContext.getInstance("TLS")
    ssl.init(null, arrayOf<TrustManager>(TrustAnything), SecureRandom())
    // The plain socket is opened first so a SOCKS route can carry an UNRESOLVED
    // target: `createUnresolved` is what makes Tor, not the phone, resolve the
    // name. TLS is layered on top of whichever socket that produced, so the
    // certificate read below is the server's either way.
    val raw = if (socksPort > 0) Socket(socksProxy(socksPort)) else Socket()
    val socket = try {
      raw.connect(
        if (socksPort > 0) InetSocketAddress.createUnresolved(host, port) else InetSocketAddress(host, port),
        timeoutMs,
      )
      ssl.socketFactory.createSocket(raw, host, port, true) as SSLSocket
    } catch (failure: Exception) {
      try {
        raw.close()
      } catch (ignored: Exception) {
        Log.w(TAG, "could not close the probe socket", ignored)
      }
      if (failure is java.net.SocketTimeoutException) {
        throw MultibotTlsException("timeout", "The server did not answer in time.", failure)
      }
      throw MultibotTlsException("unreachable", failure.message ?: "Could not reach the server.", failure)
    }
    try {
      // Without SNI a name-based virtual host answers with somebody else's
      // certificate and the pin is learned for the wrong thing. An IP literal is
      // not a legal SNI name, so it is left out there.
      if (!isIpLiteral(host)) {
        val params = socket.sslParameters
        params.serverNames = listOf(SNIHostName(host))
        socket.sslParameters = params
      }
      socket.soTimeout = timeoutMs
      socket.startHandshake()
      val leaf = socket.session.peerCertificates.firstOrNull()
        ?: throw MultibotTlsException("not_multibot", "The server presented no certificate.", null)
      return sha256Hex(leaf.encoded)
    } catch (coded: MultibotTlsException) {
      throw coded
    } catch (timeout: java.net.SocketTimeoutException) {
      throw MultibotTlsException("timeout", "The server did not answer in time.", timeout)
    } catch (failure: Exception) {
      throw MultibotTlsException("unreachable", failure.message ?: "Could not reach the server.", failure)
    } finally {
      try {
        socket.close()
      } catch (ignored: Exception) {
        Log.w(TAG, "could not close the probe socket", ignored)
      }
    }
  }

  @Volatile
  private var installed = false

  /**
   * Routes React Native's `fetch` through a client that also accepts the exact
   * certificate pinned for the host being dialled. Everything the system already
   * trusts keeps working unchanged, and an unpinned host gets the platform
   * default and nothing more.
   */
  @Synchronized
  fun installOkHttpFactory(context: Context) {
    if (installed) return
    val app = context.applicationContext
    val systemVerifier: HostnameVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
    OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
      override fun createNewNetworkModuleClient(): OkHttpClient {
        val trustManager = PinningTrustManager(app)
        val ssl = SSLContext.getInstance("TLS")
        ssl.init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
        return OkHttpClientProvider.createClientBuilder(app)
          .sslSocketFactory(ssl.socketFactory, trustManager)
          // `.onion` goes through Tor and nowhere else: the selector routes it
          // and the resolver refuses it, so neither a missing route nor an
          // unexpected redirect can turn one into a DNS query.
          .proxySelector(OnionProxySelector)
          .dns(NoOnionDns)
          .hostnameVerifier { hostname, session ->
            systemVerifier.verify(hostname, session) || isPinnedSession(app, hostname, session)
          }
          .build()
      }
    })
    // Only after the factory is actually in place: a throw above has to leave
    // the next caller free to try again, not pretend fetch is already pinned.
    installed = true
  }

  private fun isPinnedSession(context: Context, hostname: String, session: SSLSession): Boolean = try {
    val leaf = session.peerCertificates.firstOrNull()
    leaf != null && pinned(context, keyFor(hostname, session.peerPort))
      .equals(sha256Hex(leaf.encoded), ignoreCase = true)
  } catch (unverified: Exception) {
    Log.w(TAG, "could not read the certificate offered by $hostname", unverified)
    false
  }

  private fun isPinnedChain(context: Context, host: String?, port: Int, chain: Array<out X509Certificate>): Boolean {
    if (host == null) {
      Log.w(TAG, "certificate check without a host — refusing to match a pin")
      return false
    }
    return try {
      val leaf = chain.firstOrNull() ?: return false
      pinned(context, keyFor(host, port)).equals(sha256Hex(leaf.encoded), ignoreCase = true)
    } catch (broken: Exception) {
      Log.w(TAG, "could not hash the certificate offered by $host", broken)
      false
    }
  }

  /**
   * Extends rather than implements X509TrustManager on purpose: only the
   * socket/engine overloads say WHICH host is being dialled, and a pin that is
   * not tied to a host is not a pin.
   */
  private class PinningTrustManager(private val context: Context) : X509ExtendedTrustManager() {
    private val system: X509ExtendedTrustManager = systemTrustManager()

    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) =
      system.checkClientTrusted(chain, authType)

    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String, socket: Socket?) =
      system.checkClientTrusted(chain, authType, socket)

    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String, engine: SSLEngine?) =
      system.checkClientTrusted(chain, authType, engine)

    // No host, no pin: this overload cannot tell one server from another, so it
    // gets the platform answer and nothing else.
    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) =
      system.checkServerTrusted(chain, authType)

    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String, socket: Socket?) {
      try {
        system.checkServerTrusted(chain, authType, socket)
      } catch (untrusted: CertificateException) {
        val host = (socket as? SSLSocket)?.handshakeSession?.peerHost ?: socket?.inetAddress?.hostAddress
        if (!isPinnedChain(context, host, socket?.port ?: -1, chain)) throw untrusted
      }
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String, engine: SSLEngine?) {
      try {
        system.checkServerTrusted(chain, authType, engine)
      } catch (untrusted: CertificateException) {
        if (!isPinnedChain(context, engine?.peerHost, engine?.peerPort ?: -1, chain)) throw untrusted
      }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
  }

  private fun systemTrustManager(): X509ExtendedTrustManager {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    return factory.trustManagers.filterIsInstance<X509ExtendedTrustManager>().firstOrNull()
      ?: throw IllegalStateException("No X509ExtendedTrustManager on this device.")
  }

  /** Used only by [probeFingerprint], which reads the certificate and disconnects. */
  private object TrustAnything : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) = Unit
    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) = Unit
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
  }
}
