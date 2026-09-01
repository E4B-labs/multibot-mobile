# Security policy

## Reporting

Do not publish vulnerability details in an issue. Use GitHub's private
vulnerability reporting for this repository. Include affected version,
reproduction steps, impact, and logs with credentials removed.

## Mobile boundaries

- Treat host URLs, bearer tokens, pairing data, provider keys, push tokens, and
  device identifiers as secrets.
- Store credentials with the platform secure store; never put them in logs,
  screenshots, URLs, crash reports, or source control.
- Connect only to hosts you trust and verify update sources before installing
  native packages.
- Keep signing credentials and push-provider configuration outside the public
  repository.
