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
/**
 * Decode the HTML entities that appear in real search-result and page
 * markup: the named set above plus decimal/hex numeric references.
 * Unknown entities pass through unchanged.
 *
 * @param s - The raw (possibly entity-encoded) text.
 * @returns The decoded text.
 */
export declare function decodeEntities(s: string): string;
/**
 * Remove all tags from an HTML fragment and return its text, decoded.
 *
 * @param html - The fragment.
 * @returns Plain text with whitespace collapsed to single spaces.
 */
export declare function fragmentText(html: string): string;
/**
 * Extract readable text from a full HTML page: drop non-content blocks,
 * turn block boundaries into line breaks, strip the remaining tags,
 * decode entities, and normalize blank lines. Line order follows the
 * document.
 *
 * @param html - The page source.
 * @returns The readable text (may be empty for a page with no text).
 */
export declare function extractReadableText(html: string): string;
