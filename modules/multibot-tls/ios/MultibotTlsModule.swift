import CommonCrypto
import ExpoModulesCore
import Network

/// Trust-on-first-use store for MultiBot's self-signed server certificates.
///
/// The `UserDefaults(suiteName: "multibot_tls")` entries (key `host:port`,
/// lowercase, no IPv6 brackets, 443 default) are read back by the WKWebView and
/// NSURLSession patches that `plugins/with-tls-pinning.js` writes into
/// react-native-webview and React Native at prebuild. A pin is scoped to one
/// `host:port` — the key format has to stay identical there, in the Android
/// module, and in `src/lib/host-logic.ts`.
public class MultibotTlsModule: Module {
  private static let suite = "multibot_tls"

  private static func store() -> UserDefaults {
    return UserDefaults(suiteName: suite) ?? UserDefaults.standard
  }

  static func hex(_ data: Data) -> String {
    var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    data.withUnsafeBytes { bytes in
      _ = CC_SHA256(bytes.baseAddress, CC_LONG(data.count), &digest)
    }
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  public func definition() -> ModuleDefinition {
    Name("MultibotTls")

    Function("trust") { (key: String, fingerprint: String) -> String in
      let next = fingerprint.lowercased()
      let store = MultibotTlsModule.store()
      guard let existing = store.string(forKey: key) else {
        store.set(next, forKey: key)
        return "trusted"
      }
      return existing.lowercased() == next ? "unchanged" : "certificate_changed"
    }

    Function("forget") { (key: String) in
      MultibotTlsModule.store().removeObject(forKey: key)
    }

    Function("pinned") { (key: String) -> String? in
      MultibotTlsModule.store().string(forKey: key)
    }

    // iOS carries the patches inside the app binary, so there is no separate
    // resource to look for — reaching this module at all means it was built.
    Function("markerPresent") { true }

    // iOS has no Android-style battery-optimization allowlist.
    Function("isIgnoringBatteryOptimizations") { true }

    AsyncFunction("sha256File") { (path: String) -> String in
      let url = path.hasPrefix("file:") ? URL(string: path)! : URL(fileURLWithPath: path)
      return MultibotTlsModule.hex(try Data(contentsOf: url, options: .mappedIfSafe))
    }

    // Reads the leaf certificate straight off the TLS handshake and hangs up;
    // no HTTP request reaches a server that has not been trusted yet.
    // iOS has no embedded Tor (there is no supported way to ship and exec the
    // binary), so the port is accepted and ignored — `MultibotTor` is absent
    // here and every `.onion` address is refused in JavaScript before it gets
    // this far. Keeping the signature identical is what lets one `tls.ts` serve
    // both platforms.
    Function("setTorSocksPort") { (_: Int) in }

    AsyncFunction("probeFingerprint") { (url: String, timeoutMs: Int, _: Int, promise: Promise) in
      guard
        let parsed = URL(string: url),
        let host = parsed.host,
        let port = NWEndpoint.Port(rawValue: UInt16(exactly: parsed.port ?? 443) ?? 443)
      else {
        promise.reject("unreachable", "Not a valid address.")
        return
      }

      // Settled once, from whichever of three threads gets there first: the
      // verify block, the state handler, or the timeout.
      let lock = NSLock()
      var settled = false
      var live: NWConnection?
      let finish: (String?, String, String) -> Void = { fingerprint, code, message in
        lock.lock()
        if settled {
          lock.unlock()
          return
        }
        settled = true
        let connection = live
        live = nil
        lock.unlock()
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        if let fingerprint = fingerprint {
          promise.resolve(fingerprint)
        } else {
          promise.reject(code, message)
        }
      }

      let options = NWProtocolTLS.Options()
      sec_protocol_options_set_verify_block(
        options.securityProtocolOptions,
        { (_, trustRef, complete) in
          let trust = sec_trust_copy_ref(trustRef).takeRetainedValue()
          var leaf: SecCertificate?
          if #available(iOS 15.0, *) {
            leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first
          } else {
            leaf = SecTrustGetCertificateAtIndex(trust, 0)
          }
          if let leaf = leaf {
            finish(MultibotTlsModule.hex(SecCertificateCopyData(leaf) as Data), "", "")
          }
          // The handshake itself is irrelevant: only the certificate was wanted.
          complete(true)
        },
        DispatchQueue.global(qos: .userInitiated)
      )

      let connection = NWConnection(
        to: NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: port),
        using: NWParameters(tls: options)
      )
      lock.lock()
      live = connection
      lock.unlock()

      connection.stateUpdateHandler = { [weak connection] state in
        switch state {
        case .ready:
          connection?.cancel()
        case .failed(let error):
          finish(nil, "unreachable", error.localizedDescription)
        case .waiting(let error):
          // Waiting means the path is down or the port is closed; NWConnection
          // would retry until the timeout, which only delays the same answer.
          finish(nil, "unreachable", error.localizedDescription)
        case .cancelled:
          finish(nil, "unreachable", "The connection closed before the certificate arrived.")
        default:
          break
        }
      }
      connection.start(queue: .global(qos: .userInitiated))
      DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
        finish(nil, "timeout", "The server did not answer in time.")
      }
    }
  }
}
