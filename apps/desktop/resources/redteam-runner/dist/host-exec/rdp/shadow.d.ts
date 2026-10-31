/** Read-only PowerShell: enumerate live RDP sessions + shadow policy state. */
export declare const RDP_SHADOW_PREP_PS: string;
/**
 * Build the human handoff package for RDP shadowing from the read-only
 * enumeration output. Pure function — tested directly.
 */
export declare function buildShadowHandoff(prepJson: string, host: string): string;
