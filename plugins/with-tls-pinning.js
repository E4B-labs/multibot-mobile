// MultiBot serves its web UI over HTTPS with a self-signed certificate (server
// PR 3b), so every client has to decide for itself whether to trust it. Desktop
// pins the fingerprint in Electron; the phone has no equivalent hook:
//
//   * react-native-webview 13.15.0 hard-codes `handler.cancel()` in
//     `onReceivedSslError` (RNCWebViewClient.java) — no prop, no callback;
//   * on iOS the same decision lives in `RNCWebViewImpl.m`
//     `webView:didReceiveAuthenticationChallenge:`;
//   * React Native's own `fetch` on iOS goes through `RCTHTTPRequestHandler.mm`,
//     which never implements a challenge delegate at all.
//
// So this plugin patches those three files at prebuild. Android `fetch` needs no
// patch: the local Expo module (`modules/multibot-tls`) installs an
// `OkHttpClientProvider` factory with the same trust rule.
//
// Trust store, identical in all four places:
//   Android  SharedPreferences("multibot_tls")            key `host:port` -> sha256 hex
//   iOS      NSUserDefaults suite "multibot_tls"          key `host:port` -> sha256 hex
// written from JS through the Expo module (trust-on-first-use).
//
// ponytail: sed over node_modules; the upgrade path is a react-native-webview
// fork with a real `onReceivedSslError` prop, at which point (a) goes away.
//
// Every patch is idempotent (marker check) and fails LOUDLY when its anchor is
// gone — a react-native-webview or React Native bump must break the build here
// rather than silently ship an app that trusts nothing (or everything).

const fs = require("fs");
const path = require("path");

const MARKER = "multibot-tls-pinning";

/** Patch that could not find its anchor is a broken build, not a warning. */
function anchor(source, needle, file) {
  const at = source.indexOf(needle);
  if (at === -1) {
    throw new Error(
      `with-tls-pinning: anchor not found in ${file}. The upstream file changed; ` +
        `re-check the patch before shipping — without it the app cannot reach any MultiBot server.`,
    );
  }
  if (source.indexOf(needle, at + needle.length) !== -1) {
    throw new Error(`with-tls-pinning: anchor is ambiguous in ${file} (matched more than once).`);
  }
  return at;
}

function insertBefore(source, needle, block, file) {
  const at = anchor(source, needle, file);
  return source.slice(0, at) + block + source.slice(at);
}

// --- Android: react-native-webview -----------------------------------------

const JAVA_ANCHOR = "        handler.cancel();\n";

const JAVA_PATCH = `        // BEGIN ${MARKER} (plugins/with-tls-pinning.js)
        // MultiBot servers use a self-signed certificate. Proceed only when its
        // SHA-256 is exactly the fingerprint the user trusted for this host.
        try {
            android.net.http.SslCertificate mbCert = error.getCertificate();
            java.security.cert.X509Certificate mbX509 = null;
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                mbX509 = mbCert.getX509Certificate();
            }
            if (mbX509 == null) {
                android.os.Bundle mbState = android.net.http.SslCertificate.saveState(mbCert);
                byte[] mbDer = mbState == null ? null : mbState.getByteArray("x509-certificate");
                if (mbDer != null) {
                    mbX509 = (java.security.cert.X509Certificate) java.security.cert.CertificateFactory
                            .getInstance("X.509")
                            .generateCertificate(new java.io.ByteArrayInputStream(mbDer));
                }
            }
            if (mbX509 != null) {
                byte[] mbDigest = java.security.MessageDigest.getInstance("SHA-256").digest(mbX509.getEncoded());
                StringBuilder mbHex = new StringBuilder(mbDigest.length * 2);
                for (byte mbByte : mbDigest) {
                    mbHex.append(String.format("%02x", mbByte));
                }
                android.net.Uri mbUri = android.net.Uri.parse(failingUrl);
                String mbHost = mbUri.getHost();
                if (mbHost != null) {
                    if (mbHost.startsWith("[") && mbHost.endsWith("]")) {
                        mbHost = mbHost.substring(1, mbHost.length() - 1);
                    }
                    int mbPort = mbUri.getPort();
                    // Locale.ROOT: a Turkish phone would otherwise fold "I" to
                    // a dotless i and never match the key JavaScript wrote.
                    String mbKey = mbHost.toLowerCase(java.util.Locale.ROOT) + ":" + (mbPort == -1 ? 443 : mbPort);
                    String mbPinned = webView.getContext()
                            .getSharedPreferences("multibot_tls", android.content.Context.MODE_PRIVATE)
                            .getString(mbKey, null);
                    if (mbPinned != null && mbPinned.equalsIgnoreCase(mbHex.toString())) {
                        handler.proceed();
                        return;
                    }
                }
            }
        } catch (Exception mbPinningError) {
            Log.w(TAG, "${MARKER}: could not check the pinned certificate", mbPinningError);
        }
        // END ${MARKER}
`;

/** Exported for the plugin test: runs against the real RNCWebViewClient.java. */
function patchWebViewClientJava(source) {
  if (source.includes(MARKER)) return source;
  return insertBefore(source, JAVA_ANCHOR, JAVA_PATCH, "RNCWebViewClient.java");
}

// --- iOS: shared helper -----------------------------------------------------

const OBJC_HELPER = `// BEGIN ${MARKER} (plugins/with-tls-pinning.js)
#import <CommonCrypto/CommonDigest.h>

// YES when the server certificate is byte-for-byte the one the user trusted for
// this host (trust-on-first-use; the store is written by modules/multibot-tls).
static BOOL MultibotTlsTrusted(SecTrustRef mbTrust, NSString *mbHost, NSInteger mbPort)
{
  if (mbTrust == NULL || mbHost.length == 0) {
    return NO;
  }
  NSString *mbBare = [mbHost hasPrefix:@"["] && [mbHost hasSuffix:@"]"]
      ? [mbHost substringWithRange:NSMakeRange(1, mbHost.length - 2)]
      : mbHost;
  NSString *mbKey = [NSString stringWithFormat:@"%@:%ld", mbBare.lowercaseString, (long)(mbPort <= 0 ? 443 : mbPort)];
  NSUserDefaults *mbStore = [[NSUserDefaults alloc] initWithSuiteName:@"multibot_tls"];
  NSString *mbPinned = [mbStore stringForKey:mbKey];
  if (mbPinned.length == 0) {
    return NO;
  }
  SecCertificateRef mbLeaf = NULL;
  NSArray *mbChain = nil;
  if (@available(iOS 15.0, macOS 12.0, *)) {
    mbChain = (NSArray *)CFBridgingRelease(SecTrustCopyCertificateChain(mbTrust));
    mbLeaf = mbChain.count > 0 ? (__bridge SecCertificateRef)mbChain[0] : NULL;
  } else {
    mbLeaf = SecTrustGetCertificateAtIndex(mbTrust, 0);
  }
  if (mbLeaf == NULL) {
    return NO;
  }
  NSData *mbDer = (NSData *)CFBridgingRelease(SecCertificateCopyData(mbLeaf));
  unsigned char mbDigest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(mbDer.bytes, (CC_LONG)mbDer.length, mbDigest);
  NSMutableString *mbHex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (int mbIndex = 0; mbIndex < CC_SHA256_DIGEST_LENGTH; mbIndex++) {
    [mbHex appendFormat:@"%02x", mbDigest[mbIndex]];
  }
  return [mbHex caseInsensitiveCompare:mbPinned] == NSOrderedSame;
}
// END ${MARKER}

`;

// --- iOS: react-native-webview ---------------------------------------------

const WEBVIEW_IMPL_HELPER_ANCHOR = "@implementation RNCWebViewImpl\n";
const WEBVIEW_IMPL_CALL_ANCHOR =
  "  completionHandler(NSURLSessionAuthChallengePerformDefaultHandling, nil);\n}\n\n#pragma mark - WKNavigationDelegate methods";

const WEBVIEW_IMPL_CALL = `  // BEGIN ${MARKER}
  if (MultibotTlsTrusted([[challenge protectionSpace] serverTrust], [[challenge protectionSpace] host], [[challenge protectionSpace] port])) {
    completionHandler(NSURLSessionAuthChallengeUseCredential,
                      [NSURLCredential credentialForTrust:[[challenge protectionSpace] serverTrust]]);
    return;
  }
  // END ${MARKER}
`;

/** Exported for the plugin test: runs against the real RNCWebViewImpl.m. */
function patchWebViewImplObjC(source) {
  if (source.includes(MARKER)) return source;
  const withHelper = insertBefore(source, WEBVIEW_IMPL_HELPER_ANCHOR, OBJC_HELPER, "RNCWebViewImpl.m");
  return insertBefore(withHelper, WEBVIEW_IMPL_CALL_ANCHOR, WEBVIEW_IMPL_CALL, "RNCWebViewImpl.m");
}

// --- iOS: React Native's own fetch ------------------------------------------

const REQUEST_HANDLER_ANCHOR = "#pragma mark - NSURLSession delegate\n";

const REQUEST_HANDLER_METHOD = `
// BEGIN ${MARKER}
- (void)URLSession:(NSURLSession *)session
    didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge
      completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))completionHandler
{
  SecTrustRef mbTrust = [[challenge protectionSpace] serverTrust];
  if (mbTrust != NULL &&
      MultibotTlsTrusted(mbTrust, [[challenge protectionSpace] host], [[challenge protectionSpace] port])) {
    completionHandler(NSURLSessionAuthChallengeUseCredential, [NSURLCredential credentialForTrust:mbTrust]);
    return;
  }
  completionHandler(NSURLSessionAuthChallengePerformDefaultHandling, nil);
}
// END ${MARKER}
`;

/** Exported for the plugin test: runs against the real RCTHTTPRequestHandler.mm. */
function patchRequestHandlerObjC(source) {
  if (source.includes(MARKER)) return source;
  const withHelper = insertBefore(source, REQUEST_HANDLER_ANCHOR, OBJC_HELPER, "RCTHTTPRequestHandler.mm");
  const at = anchor(withHelper, REQUEST_HANDLER_ANCHOR, "RCTHTTPRequestHandler.mm") + REQUEST_HANDLER_ANCHOR.length;
  return withHelper.slice(0, at) + REQUEST_HANDLER_METHOD + withHelper.slice(at);
}

function patchFile(projectRoot, relativePath, patch) {
  const file = path.join(projectRoot, relativePath);
  const before = fs.readFileSync(file, "utf8");
  const after = patch(before);
  if (after !== before) fs.writeFileSync(file, after);
}

const RNWV_JAVA = "node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java";
const RNWV_OBJC = "node_modules/react-native-webview/apple/RNCWebViewImpl.m";
const RN_REQUEST_HANDLER = "node_modules/react-native/Libraries/Network/RCTHTTPRequestHandler.mm";

function withTlsPinning(config) {
  const { withDangerousMod, withAndroidManifest } = require("expo/config-plugins");

  let next = withDangerousMod(config, [
    "android",
    (cfg) => {
      patchFile(cfg.modRequest.projectRoot, RNWV_JAVA, patchWebViewClientJava);
      return cfg;
    },
  ]);

  next = withDangerousMod(next, [
    "ios",
    (cfg) => {
      patchFile(cfg.modRequest.projectRoot, RNWV_OBJC, patchWebViewImplObjC);
      patchFile(cfg.modRequest.projectRoot, RN_REQUEST_HANDLER, patchRequestHandlerObjC);
      return cfg;
    },
  ]);

  // Not TLS, but the only local plugin this app has and too small for its own
  // file: Android 11+ hides other packages, and "Set up a server" launches
  // Termux by explicit package name. Without this the intent throws.
  next = withAndroidManifest(next, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];
    const queries = manifest.queries[0];
    queries.package = queries.package ?? [];
    if (!queries.package.some((entry) => entry?.$?.["android:name"] === "com.termux")) {
      queries.package.push({ $: { "android:name": "com.termux" } });
    }
    return cfg;
  });

  return next;
}

module.exports = withTlsPinning;
module.exports.MARKER = MARKER;
module.exports.patchWebViewClientJava = patchWebViewClientJava;
module.exports.patchWebViewImplObjC = patchWebViewImplObjC;
module.exports.patchRequestHandlerObjC = patchRequestHandlerObjC;
