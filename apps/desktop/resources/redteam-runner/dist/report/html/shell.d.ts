export interface HtmlDocumentInput {
    /** Page title: "<document title> — <target>". */
    title: string;
    /** The rendered body sections, already joined. */
    body: string;
}
/** Render one complete, self-contained HTML document. */
export declare function renderHtmlDocument(o: HtmlDocumentInput): string;
