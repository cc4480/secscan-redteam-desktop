/**
 * Q-RP-2 — the OOXML primitives behind report/docx.ts: XML escaping,
 * paragraph/run builders, and the static package parts (content types,
 * relationships, styles). Text is data only — every caller-supplied
 * string passes through xesc, so target-derived text can never break
 * out of a text node. The styles are the document's own minimal set
 * (Title / Heading1-3 / Normal); Word renders them natively.
 */
/** Escape a string for an XML text node (quotes included, so the same
 * helper is safe for attribute values too). */
export declare function xesc(s: string): string;
export interface RunSeg {
    text: string;
    bold?: boolean;
    italic?: boolean;
}
/** One paragraph. `style` names a styles.xml paragraph style. */
export declare function para(segs: RunSeg[] | string, style?: string): string;
/** A heading paragraph at level 1–3. */
export declare function heading(text: string, level: 1 | 2 | 3): string;
/** A labelled body block: the bold label paragraph, then one paragraph
 * per line of the (possibly multi-line) recorded text. */
export declare function labelledBlock(label: string, text: string): string[];
/** word/document.xml around the assembled body paragraphs. */
export declare function documentXml(bodyParas: string[]): string;
export declare const CONTENT_TYPES_XML: string;
export declare const RELS_XML: string;
export declare const DOC_RELS_XML: string;
export declare const STYLES_XML: string;
