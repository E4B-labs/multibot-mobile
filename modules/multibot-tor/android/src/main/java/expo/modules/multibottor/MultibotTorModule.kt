package expo.modules.multibottor

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JavaScript's view of the embedded Tor client (`src/lib/tor.ts`).
 *
 * Nothing here starts on its own: a host that is not a `.onion` address never
 * calls `start`, so an app that never meets one never runs tor at all.
 */
class MultibotTorModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MultibotTor")

    /** Resolves once tor has bootstrapped: `{ socksPort, bridgePort }`. */
    AsyncFunction("start") { timeoutMs: Int ->
      MultibotTor.start(context, timeoutMs)
    }

    Function("status") { MultibotTor.status() }

    Function("stop") { MultibotTor.stop() }

    AsyncFunction("setWebViewProxy") { bridgePort: Int, promise: Promise ->
      MultibotTor.setWebViewProxy(bridgePort) { failure ->
        if (failure == null) promise.resolve(null) else promise.reject(failure)
      }
    }

    AsyncFunction("clearWebViewProxy") { promise: Promise ->
      MultibotTor.clearWebViewProxy { failure ->
        if (failure == null) promise.resolve(null) else promise.reject(failure)
      }
    }

    // The app going away has to take tor with it. Without this the process
    // survives the React context, keeps the data directory locked, and the next
    // launch can never start a tor of its own.
    OnDestroy {
      MultibotTor.stop()
    }
  }
}
