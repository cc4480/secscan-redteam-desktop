/**
 * Seam type shim — NOT a vendored copy.
 *
 * scanTypes.ts type-imports TlsObservation from "./tlsProbe.js".
 * The TLS probe itself is a skip-set repeat (the embedded SecScan
 * engine covers TLS), so only the observation contract is declared
 * here, copied from the source interface.
 */
export interface TlsObservation {
  // Whether a check was attempted at all (HTTPS targets only).
  checked: boolean;
  // Whether the handshake actually completed.
  reachable: boolean;
  protocol?: string; // negotiated protocol, e.g. "TLSv1.2" / "TLSv1.3"
  validFromMs?: number; // certificate notBefore, ms epoch
  validToMs?: number; // certificate notAfter, ms epoch
  subject?: string; // cert subject CN
  issuer?: string; // cert issuer CN
}
