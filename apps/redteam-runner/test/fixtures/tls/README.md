# TLS test fixtures — THROWAWAY TEST MATERIAL ONLY

Generated 2026-10-31 with openssl for `test/tls-probe.test.ts` (Q-SSLLABS).
The private keys in this directory belong to certificates minted for local
fixture servers on 127.0.0.1. They protect nothing, are published by design,
and must never be used for any real service.

- `ca.crt` — the test CA ("SecScan Test CA"). Fixture servers' certs below are
  signed by it; tests pass it as the probe's `ca` so trust is genuinely
  evaluated instead of disabled.
- `good.crt` / `good.key` — CA-signed, SAN `DNS:localhost, IP:127.0.0.1`,
  validity window covering the present. The clean fixture.
- `expired.crt` / `expired.key` — CA-signed, SAN localhost, 2020-01-01 →
  2021-01-01. Genuinely expired.
- `notyet.crt` / `notyet.key` — CA-signed, SAN localhost, 2030-01-01 →
  2031-01-01. Genuinely not yet valid.
- `wronghost.crt` / `wronghost.key` — CA-signed, SAN `DNS:other.example` only.
  Genuine hostname mismatch for `localhost`.
- `selfsigned.crt` / `selfsigned.key` — self-signed, SAN localhost, valid
  window. Genuinely untrusted under the test CA.
