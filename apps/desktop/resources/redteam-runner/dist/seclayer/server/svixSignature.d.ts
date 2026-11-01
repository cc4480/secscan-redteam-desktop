/**
 * Verify a Svix-signed webhook, which is how Resend signs its delivery events.
 *
 * Implemented here rather than pulling in the `svix` package: the scheme is
 * three headers and one HMAC, and a webhook that can mark addresses
 * undeliverable is not somewhere to add dependency surface for thirty lines of
 * crypto.
 *
 * WHY THIS MUST BE VERIFIED AT ALL. The endpoint it guards writes to the
 * suppression list. Unauthenticated, anyone who found the URL could POST a
 * forged "hard bounce" for any address and permanently stop that person
 * receiving sign-in codes — a denial-of-service against a named account, with
 * no login required and nothing in the logs that looks wrong.
 *
 * The scheme (https://docs.svix.com/receiving/verifying-payloads):
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   signature      = base64(HMAC-SHA256(base64decode(secret), signed content))
 *   svix-signature = space-delimited list of `v1,<signature>` (several during
 *                    a secret rotation, any one of which may match)
 */
/**
 * How far out of step a webhook's timestamp may be.
 *
 * Without this, a signature stays valid forever and a captured request can be
 * replayed indefinitely — re-suppressing an address the user has since fixed.
 * Five minutes each way is Svix's own tolerance and covers ordinary clock drift.
 */
export declare const TIMESTAMP_TOLERANCE_SECONDS: number;
export type SvixFailure = "missing_headers" | "bad_timestamp" | "timestamp_out_of_tolerance" | "no_signatures" | "no_match";
export type SvixResult = {
    ok: true;
} | {
    ok: false;
    reason: SvixFailure;
};
/**
 * @param secret The endpoint secret, as Resend shows it (`whsec_…`). The prefix
 *               is stripped; what follows is base64 and is the actual HMAC key.
 * @param rawBody The body EXACTLY as received. Re-serialising parsed JSON will
 *                not match — key order and whitespace are part of what is signed.
 */
export declare function verifySvixSignature(secret: string, rawBody: string, headers: {
    id?: string;
    timestamp?: string;
    signature?: string;
}, now?: Date): SvixResult;
