/**
 * Whether `signature` is already present WITHOUT the attack payload.
 *
 * `true` means the signature is static page content and the caller must NOT
 * report a finding, however convincing the match looked.
 *
 * Fails CLOSED on a transport error: if the baseline cannot be fetched we
 * cannot show the payload caused anything, so the caller suppresses. A probe
 * that reported a critical vulnerability because its control request happened
 * to time out would be worse than one that occasionally stays quiet — and the
 * next scan re-tests it anyway.
 */
export declare function signaturePreexists(baselineUrl: string, headers: Record<string, string>, signature: RegExp): Promise<boolean>;
