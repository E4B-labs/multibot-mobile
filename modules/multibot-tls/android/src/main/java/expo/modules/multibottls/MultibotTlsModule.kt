package expo.modules.multibottls

import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MultibotTlsModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MultibotTls")

    // The OkHttp factory has to be in place before the first `fetch` runs, and
    // modules are created while the React context comes up — earlier than any
    // JavaScript. `trust` re-attempts it, because an install that threw must not
    // leave `fetch` quietly unpinned for the rest of the session.
    OnCreate {
      appContext.reactContext?.let {
        MultibotTls.installOkHttpFactory(it)
        warnIfUnpatched()
      }
    }

    Function("trust") { key: String, fingerprint: String ->
      MultibotTls.installOkHttpFactory(context)
      MultibotTls.trust(context, key, fingerprint)
    }

    Function("forget") { key: String ->
      MultibotTls.forget(context, key)
    }

    Function("pinned") { key: String ->
      MultibotTls.pinned(context, key)
    }

    /** False means the prebuild patches are missing and the WebView refuses every server. */
    Function("markerPresent") { markerPresent() }

    AsyncFunction("probeFingerprint") { url: String, timeoutMs: Int ->
      MultibotTls.probeFingerprint(url, timeoutMs)
    }

    AsyncFunction("sha256File") { path: String ->
      MultibotTls.sha256File(path)
    }
  }

  // `plugins/with-tls-pinning.js` writes this string resource in the same run
  // that patches the WebView sources. Its absence means the app was assembled
  // without the plugin — invisible until the first server refuses to load, so
  // say it loudly in logcat at start.
  private fun markerPresent(): Boolean {
    val ctx = appContext.reactContext ?: return false
    val id = ctx.resources.getIdentifier("multibot_tls_patched", "string", ctx.packageName)
    return id != 0 && ctx.resources.getString(id) == "true"
  }

  private fun warnIfUnpatched() {
    if (!markerPresent()) {
      Log.e(
        MultibotTls.TAG,
        "TLS pinning patches are MISSING from this build (plugins/with-tls-pinning.js did not run). " +
          "The WebView will reject every self-signed MultiBot server.",
      )
    }
  }
}
