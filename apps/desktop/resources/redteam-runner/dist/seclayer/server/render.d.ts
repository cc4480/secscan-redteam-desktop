export interface RenderResult {
    html: string;
    requestedUrls: string[];
    status: number | null;
    headers: Record<string, string>;
    finalUrl: string | null;
}
export declare function isRenderingEnabled(): boolean;
export declare function isScreenshotEnabled(): boolean;
export declare function hostLooksInternal(hostname: string): boolean;
export declare function renderPage(url: string, extraHeaders: Record<string, string>, timeoutMs?: number): Promise<RenderResult | null>;
export interface ScreenshotResult {
    dataUri: string;
    capturedAt: string;
    width: number;
    height: number;
}
export declare function captureScreenshot(url: string, extraHeaders: Record<string, string>, timeoutMs?: number): Promise<ScreenshotResult | null>;
