Pod::Spec.new do |s|
  s.name           = 'MultibotTls'
  s.version        = '0.1.0'
  s.summary        = 'Trust-on-first-use pinning for MultiBot self-signed servers.'
  s.description    = 'Stores the SHA-256 of a MultiBot server certificate and probes a host for its fingerprint.'
  s.author         = 'E4B-labs'
  s.homepage       = 'https://github.com/E4B-labs/multibot-mobile'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/E4B-labs/multibot-mobile.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
