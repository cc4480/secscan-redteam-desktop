/**
 * Finding classification into Foundry families.
 *
 * Signals, in trust order: an explicit CWE, the runner's own vulnClass,
 * then class keywords in the finding title. A finding that matches nothing
 * lands in the explicit "unclassified" bucket — a fit is never forced.
 */
/** Canonical CWE per family, used when the class signal is unambiguous. */
export const FAMILY_CWE = {
    sqli: 'CWE-89',
    xss: 'CWE-79',
    ssrf: 'CWE-918',
    traversal: 'CWE-22',
};
const CWE_TO_FAMILY = {
    'CWE-89': 'sqli',
    'CWE-79': 'xss',
    'CWE-918': 'ssrf',
    'CWE-22': 'traversal',
};
const CLASS_PATTERNS = [
    { family: 'sqli', pattern: /sql[-\s]?injection|\bsqli\b/i },
    { family: 'xss', pattern: /cross[-\s]?site[-\s]?scripting|\bxss\b|reflected[-\s]?script/i },
    { family: 'ssrf', pattern: /server[-\s]?side[-\s]?request[-\s]?forgery|\bssrf\b/i },
    { family: 'traversal', pattern: /path[-\s]?traversal|directory[-\s]?traversal|dotdot/i },
];
/**
 * Extract the first CWE id mentioned in a text.
 *
 * @param text - the text to scan
 * @returns the CWE id (e.g. "CWE-89"), or null
 */
export function cweIn(text) {
    const match = /CWE-\d+/i.exec(text);
    return match ? match[0].toUpperCase() : null;
}
/**
 * Classify one finding.
 *
 * @param input - the finding's vulnClass (when the runner recorded one),
 *   title, and any CWE the caller already extracted
 * @returns the family, the CWE to record, and which signal decided it
 */
export function classifyFinding(input) {
    const explicit = input.cwe ?? cweIn(input.title);
    const explicitFamily = explicit ? CWE_TO_FAMILY[explicit] : undefined;
    if (explicit && explicitFamily) {
        return { family: explicitFamily, cwe: explicit, via: 'cwe' };
    }
    if (input.vulnClass) {
        for (const { family, pattern } of CLASS_PATTERNS) {
            if (pattern.test(input.vulnClass))
                return { family, cwe: FAMILY_CWE[family], via: 'vuln-class' };
        }
    }
    for (const { family, pattern } of CLASS_PATTERNS) {
        if (pattern.test(input.title))
            return { family, cwe: FAMILY_CWE[family], via: 'title' };
    }
    return { family: 'unclassified', cwe: explicit, via: 'none' };
}
//# sourceMappingURL=classify.js.map