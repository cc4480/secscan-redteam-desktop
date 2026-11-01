/** Extracted-text ceiling retained per fetch; the cut is marked in the text. */
export declare const MAX_TEXT_CHARS = 100000;
/** One fetched page, ready for the dispatcher to format. */
export interface FetchedPage {
    /** The URL the caller asked for. */
    requestedUrl: string;
    /** The URL after redirects — the source to cite. */
    finalUrl: string;
    /** ISO retrieval timestamp. */
    retrievedAt: string;
    contentType: string;
    /** Bytes read (download-capped). */
    bytes: number;
    /** True when the download or the extracted text hit a cap. */
    truncated: boolean;
    text: string;
}
/**
 * Fetch one page and extract its readable text.
 *
 * @param url - The page URL (http/https; the dispatcher validates and
 * scope-checks it before this runs).
 * @returns The stamped page.
 */
export declare function fetchPage(url: string): Promise<FetchedPage>;
