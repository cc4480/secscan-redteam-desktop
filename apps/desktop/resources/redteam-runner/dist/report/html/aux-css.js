/**
 * Companion document classes (attestation letter, safety manifest, compliance
 * pack). Interpolated into the ONE stylesheet so these artifacts render under
 * the same design system as the engagement report instead of a second one.
 */
export const AUX_CSS = `
:root{
  --bg:#ffffff; --fg:#1a1d21; --muted:#5c6570; --line:#e3e6ea; --panel:#f7f8fa;
  --accent:#1f5fa9; --code-bg:#f2f4f7;
  --crit:#b3261e; --high:#c8500f; --med:#8a6d00; --low:#2f6f3e; --info:#4a5560;
  --ok:#2f6f3e; --warn:#8a6d00; --bad:#b3261e;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#14171a; --fg:#e6e9ec; --muted:#98a1ab; --line:#2a2f35; --panel:#1b1f24;
    --accent:#6aa9e9; --code-bg:#1e2329;
    --crit:#ff6b5e; --high:#ff9b4a; --med:#e3c14a; --low:#6fcf8b; --info:#9aa5b1;
    --ok:#6fcf8b; --warn:#e3c14a; --bad:#ff6b5e;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--bg); color:var(--fg);
  font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
.wrap{max-width:960px;margin:0 auto;padding:40px 28px 96px}
header.doc{border-bottom:2px solid var(--line);padding-bottom:22px;margin-bottom:30px}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{font-size:30px;line-height:1.2;margin:8px 0 4px;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:15px;margin:0}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px 26px;margin:22px 0 0}
.meta div{font-size:14px}
.meta dt{color:var(--muted);font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
.meta dd{margin:2px 0 0;font-weight:500;overflow-wrap:anywhere}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px;margin:24px 0 0}
.cell{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:12px 14px}
.cell .n{font-size:23px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.cell .k{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-top:3px;font-weight:600}
.cell.crit .n{color:var(--crit)} .cell.high .n{color:var(--high)}
.cell.med .n{color:var(--med)}   .cell.low .n{color:var(--low)}
.cell.info .n{color:var(--info)} .cell.ok .n{color:var(--ok)}
.cell.warn .n{color:var(--warn)}
main{margin-top:34px}
main h2{font-size:21px;margin:38px 0 12px;padding-bottom:7px;border-bottom:1px solid var(--line);letter-spacing:-.005em}
main h3{font-size:17px;margin:26px 0 8px}
main h4{font-size:15px;margin:20px 0 6px;color:var(--muted)}
main p,main li{overflow-wrap:anywhere}
main ul,main ol{padding-left:22px}
main li{margin:4px 0}
a{color:var(--accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--accent) 35%,transparent)}
a:hover{border-bottom-color:var(--accent)}
code{background:var(--code-bg);border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:13.5px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}
pre{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:13px 15px;overflow-x:auto}
pre code{background:none;border:0;padding:0;font-size:13px}
blockquote{margin:16px 0;padding:10px 16px;border-left:3px solid var(--line);background:var(--panel);color:var(--muted);border-radius:0 8px 8px 0}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14.5px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:8px 11px;text-align:left;vertical-align:top}
th{background:var(--panel);font-weight:600;font-size:13px;letter-spacing:.02em}
hr{border:0;border-top:1px solid var(--line);margin:34px 0}
/* Severity chips: the report writes "[high]" / "severity: high" into prose, so
   colour the words rather than requiring the generator to emit markup. */
.sev{font-weight:700;letter-spacing:.03em;text-transform:uppercase;font-size:.86em;padding:1px 6px;border-radius:5px}
.sev-critical{color:var(--crit);background:color-mix(in srgb,var(--crit) 13%,transparent)}
.sev-high{color:var(--high);background:color-mix(in srgb,var(--high) 13%,transparent)}
.sev-medium{color:var(--med);background:color-mix(in srgb,var(--med) 15%,transparent)}
.sev-low{color:var(--low);background:color-mix(in srgb,var(--low) 13%,transparent)}
.sev-info{color:var(--info);background:color-mix(in srgb,var(--info) 13%,transparent)}
.pill{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;
  padding:2px 9px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--muted)}
.pill.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.pill.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
.pill.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 40%,transparent)}
footer.doc{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media print{
  :root{--bg:#fff;--fg:#000;--muted:#444;--line:#bbb;--panel:#f4f4f4;--accent:#000}
  body{font-size:11.5pt}
  .wrap{max-width:none;padding:0}
  .cell,th,blockquote{background:#f4f4f4 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sev{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  main h2{page-break-after:avoid} h1,h2,h3{page-break-after:avoid}
  table,pre,blockquote{page-break-inside:avoid}
  a{color:#000;border:0;text-decoration:underline}
  footer.doc{page-break-before:auto}
}
`;
//# sourceMappingURL=aux-css.js.map