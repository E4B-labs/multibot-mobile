package expo.modules.multibottls

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
    // JavaScript.
    OnCreate {
      appContext.reactContext?.let { MultibotTls.installOkHttpFactory(it) }
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

    AsyncFunction("probeFingerprint") { url: String, timeoutMs: Int ->
      MultibotTls.probeFingerprint(url, timeoutMs)
    }
  }
}
