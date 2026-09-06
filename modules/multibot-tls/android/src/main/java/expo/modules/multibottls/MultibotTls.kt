package expo.modules.multibottls

import android.content.Context
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import java.net.InetSocketAddress
import java.net.URI
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * Trust-on-first-use store for MultiBot's self-signed server certificates.
 *
 * The same `SharedPreferences("multibot_tls")` file (key `host:port`, value
 * SHA-256 hex of the leaf certificate) is read by the WebView SSL patch that
 * `plugins/with-tls-pinning.js` writes into react-native-webview — that patch
 * deliberately re-implements the lookup inline, because react-native-webview's
 * Gradle module cannot depend on this one.
 */
object MultibotTls {
  private const val PREFS = "multibot_tls"

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  fun pinned(context: Context, key: String): String? = prefs(context).getString(key, null)

  /** "trusted" on first sight, "unchanged" when it matches, "certificate_changed" otherwise. */
  fun trust(context: Context, key: String, fingerprint: String): String {
    val next = fingerprint.lowercase()
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

  private fun fingerprints(context: Context): Set<String> =
    prefs(context).all.values.filterIsInstance<String>().map { it.lowercase() }.toSet()

  /**
   * Opens a TLS socket, reads the leaf certificate and hangs up. No HTTP request
   * is sent, so this learns a fingerprint without handing anything to a server
   * that has not been trusted yet.
   */
  fun probeFingerprint(url: String, timeoutMs: Int): String {
    val uri = URI(url)
    val host = uri.host?.trim('[', ']') ?: throw IllegalArgumentException("unreachable")
    val port = if (uri.port == -1) 443 else uri.port
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf<TrustManager>(TrustAnything), SecureRandom())
    val socket = context.socketFactory.createSocket() as SSLSocket
    return socket.use {
      it.connect(InetSocketAddress(host, port), timeoutMs)
      it.soTimeout = timeoutMs
      it.startHandshake()
      val leaf = it.session.peerCertificates.firstOrNull()
        ?: throw IllegalStateException("not_multibot")
      sha256Hex(leaf.encoded)
    }
  }

  private var installed = false

  /**
   * Routes React Native's `fetch` through a client that also accepts a
   * certificate whose fingerprint the user pinned. Everything the system already
   * trusts keeps working unchanged.
   */
  @Synchronized
  fun installOkHttpFactory(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
      override fun createNewNetworkModuleClient(): OkHttpClient {
        val trustManager = PinningTrustManager(app)
        val ssl = SSLContext.getInstance("TLS")
        ssl.init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
        val systemVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
        return OkHttpClientProvider.createClientBuilder(app)
          .sslSocketFactory(ssl.socketFactory, trustManager)
          .hostnameVerifier { hostname, session ->
            systemVerifier.verify(hostname, session) || isPinnedSession(app, session)
          }
          .build()
      }
    })
  }

  private fun isPinnedSession(context: Context, session: SSLSession): Boolean = try {
    val leaf = session.peerCertificates.firstOrNull()
    leaf != null && fingerprints(context).contains(sha256Hex(leaf.encoded))
  } catch (e: Exception) {
    false
  }

  /**
   * ponytail: a pinned fingerprint is accepted for any host, not only the one it
   * was pinned for. The store only ever holds certificates the user explicitly
   * trusted, so a byte-identical certificate is the same certificate either way.
   * Bind the check to `host:port` if this app ever holds many servers at once.
   */
  private class PinningTrustManager(private val context: Context) : X509TrustManager {
    private val system: X509TrustManager = systemTrustManager()

    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) =
      system.checkClientTrusted(chain, authType)

    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
      try {
        system.checkServerTrusted(chain, authType)
        return
      } catch (untrusted: CertificateException) {
        val leaf = chain.firstOrNull() ?: throw untrusted
        if (!fingerprints(context).contains(sha256Hex(leaf.encoded))) throw untrusted
      }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
  }

  private fun systemTrustManager(): X509TrustManager {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    return factory.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  /** Used only by [probeFingerprint], which reads the certificate and disconnects. */
  private object TrustAnything : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) = Unit
    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) = Unit
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
  }
}
