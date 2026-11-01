/**
 * Text helpers for the web research layer: HTML entity decoding and
 * readable-text extraction. Deliberately small and dependency-free —
 * search-result pages and fetched pages are untrusted input, and a
 * hand-rolled stripper over regexes is auditable in a way a DOM
 * dependency in the runner's supply chain is not. Extraction is a
 * readability heuristic, not a parser: it keeps paragraph text in
 * document order and drops chrome (scripts, styles, navigation
 * scaffolding) by tag class, never by guessing at meaning.
 */
const NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    copy: "©",
    reg: "®",
    trade: "™",
};
/**
 * Decode the HTML entities that appear in real search-result and page
 * markup: the named set above plus decimal/hex numeric references.
 * Unknown entities pass through unchanged.
 *
 * @param s - The raw (possibly entity-encoded) text.
 * @returns The decoded text.
 */
export function decodeEntities(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, body) => {
        if (body.startsWith("#x") || body.startsWith("#X")) {
            const n = parseInt(body.slice(2), 16);
            return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
        }
        if (body.startsWith("#")) {
            const n = parseInt(body.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
        }
        return NAMED_ENTITIES[body] ?? m;
    });
}
/**
 * Remove all tags from an HTML fragment and return its text, decoded.
 *
 * @param html - The fragment.
 * @returns Plain text with whitespace collapsed to single spaces.
 */
export function fragmentText(html) {
    return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
const DROP_BLOCKS = /<(script|style|noscript|template|iframe|svg|head|nav|header|footer|form|button|select|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK_BREAKS = /<\/(p|div|li|tr|h[1-6]|article|section|pre|blockquote|table)>/gi;
const LINE_BREAKS = /<br\s*\/?>/gi;
/**
 * Extract readable text from a full HTML page: drop non-content blocks,
 * turn block boundaries into line breaks, strip the remaining tags,
 * decode entities, and normalize blank lines. Line order follows the
 * document.
 *
 * @param html - The page source.
 * @returns The readable text (may be empty for a page with no text).
 */
export function extractReadableText(html) {
    const noBlocks = html.replace(DROP_BLOCKS, " ").replace(/<!--[\s\S]*?-->/g, " ");
    const withBreaks = noBlocks.replace(BLOCK_BREAKS, "\n").replace(LINE_BREAKS, "\n");
    const text = decodeEntities(withBreaks.replace(/<[^>]*>/g, ""));
    return text
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
//# sourceMappingURL=text.js.map