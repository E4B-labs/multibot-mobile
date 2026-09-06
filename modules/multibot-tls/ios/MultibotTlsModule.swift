import CommonCrypto
import ExpoModulesCore
import Network

/// Trust-on-first-use store for MultiBot's self-signed server certificates.
///
/// The `UserDefaults(suiteName: "multibot_tls")` entries (key `host:port`, value
/// SHA-256 hex of the leaf certificate) are read back by the WKWebView and
/// NSURLSession patches that `plugins/with-tls-pinning.js` writes into
/// react-native-webview and React Native at prebuild.
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

    // Reads the leaf certificate straight off the TLS handshake and hangs up;
    // no HTTP request reaches a server that has not been trusted yet.
    AsyncFunction("probeFingerprint") { (url: String, timeoutMs: Int, promise: Promise) in
      guard let parsed = URL(string: url), let host = parsed.host else {
        promise.reject("unreachable", "Not a valid address.")
        return
      }
      let port = UInt16(parsed.port ?? 443)
      let options = NWProtocolTLS.Options()
      var settled = false
      let finish: (String?, String?) -> Void = { fingerprint, error in
        guard !settled else { return }
        settled = true
        if let fingerprint = fingerprint {
          promise.resolve(fingerprint)
        } else {
          promise.reject("unreachable", error ?? "Could not reach the server.")
        }
      }

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
            finish(MultibotTlsModule.hex(SecCertificateCopyData(leaf) as Data), nil)
          }
          // The handshake itself is irrelevant: we only wanted the certificate.
          complete(true)
        },
        DispatchQueue.global(qos: .userInitiated)
      )

      let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port) ?? 443)
      let connection = NWConnection(to: endpoint, using: NWParameters(tls: options))
      connection.stateUpdateHandler = { state in
        switch state {
        case .ready, .cancelled:
          connection.cancel()
        case .failed(let error):
          finish(nil, error.localizedDescription)
          connection.cancel()
        default:
          break
        }
      }
      connection.start(queue: .global(qos: .userInitiated))
      DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
        finish(nil, "timeout")
        connection.cancel()
      }
    }
  }
}
