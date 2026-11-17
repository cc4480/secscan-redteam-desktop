/**
 * The catalog check the native TLS probe never emitted: "Weak TLS Configuration
 * (SSL Labs Grade: C–F)".
 *
 * The vendored engine already measures TLS posture itself — `src/secscan/tlsProbe.ts`
 * performs one default handshake plus pinned TLSv1/TLSv1.1 attempts, records the
 * certificate facts, and derives an A/B/C/F letter with no external input. The
 * Qualys SSL Labs client (`ssllabs.ts`) is dead code and stays that way: the
 * standalone rule forbids calling a hosted grader.
 *
 * What was missing is the CATALOG shape. The engine reports specific findings
 * ("Weak TLS — Legacy Protocol Accepted", "Expired TLS Certificate", …) but never
 * the single catalog entry the report's transport section counts. This module maps
 * the engine's letter to that entry, so the catalog check is satisfied by the same
 * locally measured facts.
 *
 * The C–F band is the catalog's own boundary: C (legacy TLS 1.0 accepted) and F
 * (the certificate fails validation) are weak; B (TLS 1.1 only) and A are not.
 *
 * This lives outside `src/secscan/` deliberately — that tree is byte-frozen
 * against AS-IS-MANIFEST.json, and the seam file for it is `dispatch/secscan.ts`.
 */
/** The catalog check's exact name, as the report's transport section counts it. */
export const WEAK_TLS_CATALOG_CHECK = 'Weak TLS Configuration (SSL Labs Grade: C–F)';
/** The engine's letters that fall inside the catalog's C–F band. */
const WEAK_GRADES = new Set(['C', 'F']);
/**
 * Severity for an engine TLS letter, or null when the letter is not in the
 * catalog's weak band (or the probe could not measure at all).
 * @param grade - the letter from `scan.tlsGrade`, or null when unmeasured.
 * @returns the severity for the catalog entry, or null when it does not apply.
 */
export function weakTlsSeverity(grade) {
    if (typeof grade !== 'string')
        return null;
    const letter = grade.trim().toUpperCase();
    if (!WEAK_GRADES.has(letter))
        return null;
    // F means the presented certificate fails validation — a trust failure, not a
    // configuration preference. C is the legacy-protocol case.
    return letter === 'F' ? 'high' : 'medium';
}
/**
 * Why the grade landed where it did, in the words the operator will read.
 * @param grade - the normalized letter.
 * @returns one sentence naming the measured cause.
 */
function gradeReason(grade) {
    if (grade === 'F') {
        return 'the presented certificate fails validation (expired, not yet valid, hostname mismatch, or an untrusted chain)';
    }
    return 'the server still accepts TLS 1.0, deprecated by RFC 8996, so a client that offers it can be forced onto a protocol exposed to downgrade and BEAST/POODLE-class attacks';
}
/**
 * Map the engine's TLS letter to the missing catalog finding.
 * @param grade - the letter from `scan.tlsGrade` (A, B, C, or F; null when unmeasured).
 * @param url - the scanned target, used for the evidence line.
 * @param attackId - ATT&CK id carried by the enclosing scan call.
 * @returns the finding to record, or null when the check does not apply.
 */
export function weakTlsCatalogFinding(grade, url, attackId) {
    const severity = weakTlsSeverity(grade);
    if (severity === null)
        return null;
    const letter = String(grade).trim().toUpperCase();
    return {
        severity,
        title: WEAK_TLS_CATALOG_CHECK,
        vulnClass: 'transport-security',
        attackId,
        evidence: `Native TLS grade ${letter} for ${url}: ${gradeReason(letter)}. ` +
            'Graded locally from this app\'s own handshakes and certificate facts; no external grading service was consulted.',
    };
}
//# sourceMappingURL=tls-grade.js.map