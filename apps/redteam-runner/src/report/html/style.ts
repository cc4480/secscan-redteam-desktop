/**
 * The unified report stylesheet — a single inline <style> block, no external
 * requests, no web fonts (system stacks only; the display/mono faces named
 * first are used when locally present, never fetched).
 *
 * Screen: Seclayer's zinc-black theme at SecScan's cover scale (max content
 * width 1024px). Print: light theme forced, token vars swapped to their
 * print hexes, cards unbreakable, @page margins per SecScan's print twin.
 */

export const REPORT_CSS = `
:root{
  --bg:#09090b; --panel:#0c0c0e; --card:#000000; --line:#27272a;
  --fg:#fafafa; --muted:#a1a1aa; --faint:#71717a; --dim:#52525b;
  --brand:#22c55e; --amber:#fbbf24; --red:#ef4444;
  --sev-critical:#f87171; --sev-high:#fb7185; --sev-medium:#fbbf24;
  --sev-low:#60a5fa; --sev-info:#a1a1aa; --secure:#22c55e;
  --sans:"Space Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 var(--sans)}
.wrap{max-width:1024px;margin:0 auto;padding:36px 24px 80px}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
h1,h2,h3{font-family:var(--sans);letter-spacing:-.01em}
.sec-title{font-size:19px;margin:40px 0 6px;padding-bottom:7px;border-bottom:1px solid var(--line)}
.sec-sub{color:var(--muted);font-size:13px;margin:0 0 16px}
code{font-family:var(--mono);font-size:.92em;overflow-wrap:anywhere}
a{color:var(--brand)}
/* ---- cover ---- */
.cover{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:26px 28px}
.cover-grid{display:flex;gap:30px;align-items:flex-start;flex-wrap:wrap}
.cover-meta{flex:1 1 420px;min-width:300px}
.target{font-family:var(--mono);font-size:19px;font-weight:700;margin:8px 0 2px;overflow-wrap:anywhere;user-select:all}
.objective{color:var(--muted);font-size:14px;margin:6px 0 0}
.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 24px;margin-top:20px}
.meta-grid dt{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.meta-grid dd{margin:2px 0 0;font-size:13.5px;font-weight:500;overflow-wrap:anywhere}
.score-block{flex:0 0 240px;text-align:center}
.posture-word{font-family:var(--mono);font-size:13px;letter-spacing:.12em;text-transform:uppercase;margin-top:10px}
.counts-line{color:var(--muted);font-size:12.5px;margin-top:6px;font-family:var(--mono)}
.pill{display:inline-block;font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;padding:2px 8px;border-radius:4px;border:1px solid var(--line);color:var(--muted)}
.pill.ok{color:var(--secure);border-color:color-mix(in srgb,var(--secure) 45%,transparent)}
.pill.bad{color:var(--red);border-color:color-mix(in srgb,var(--red) 45%,transparent)}
/* ---- gauge ---- */
.gauge{position:relative;width:176px;height:176px;margin:0 auto}
.gauge svg{display:block}
.gauge-arc{stroke:var(--grade)}
.gauge-num{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.gauge-score{font-family:var(--mono);font-size:42px;font-weight:700;line-height:1}
.gauge-score small{font-size:15px;color:var(--faint);font-weight:400}
.gauge-grade{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:5px}
/* ---- severity bar + chips ---- */
.sevbar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--line);margin:12px auto 0;max-width:230px}
.sevbar div{height:100%}
.sevbar.empty{background:color-mix(in srgb,var(--secure) 25%,transparent)}
.sevrow{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 4px}
.sevchip{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:11px;font-weight:600;
  letter-spacing:.06em;text-transform:uppercase;padding:3px 6px 3px 9px;border-radius:4px;border:1px solid}
.sevchip .n{background:rgba(0,0,0,.45);border-radius:3px;padding:0 6px;font-size:12px}
.chip-critical{color:var(--sev-critical);border-color:color-mix(in srgb,var(--sev-critical) 25%,transparent);background:color-mix(in srgb,var(--sev-critical) 10%,transparent)}
.chip-high{color:var(--sev-high);border-color:color-mix(in srgb,var(--sev-high) 25%,transparent);background:color-mix(in srgb,var(--sev-high) 10%,transparent)}
.chip-medium{color:var(--sev-medium);border-color:color-mix(in srgb,var(--sev-medium) 25%,transparent);background:color-mix(in srgb,var(--sev-medium) 10%,transparent)}
.chip-low{color:var(--sev-low);border-color:color-mix(in srgb,var(--sev-low) 25%,transparent);background:color-mix(in srgb,var(--sev-low) 10%,transparent)}
.chip-info{color:var(--sev-info);border-color:color-mix(in srgb,var(--sev-info) 25%,transparent);background:color-mix(in srgb,var(--sev-info) 10%,transparent)}
.accuracy{font-family:var(--mono);font-size:12px;color:var(--muted);margin:8px 0 0}
/* ---- posture banner + halt ---- */
.banner{border:1px solid;border-radius:8px;padding:16px 20px;margin-top:18px}
.banner h3{margin:0 0 4px;font-size:15.5px}
.banner p{margin:0;color:var(--muted);font-size:13.5px}
.banner.critical{border-color:color-mix(in srgb,var(--red) 45%,transparent);background:color-mix(in srgb,var(--red) 8%,transparent)}
.banner.critical h3{color:var(--sev-critical)}
.banner.warning{border-color:color-mix(in srgb,var(--amber) 45%,transparent);background:color-mix(in srgb,var(--amber) 7%,transparent)}
.banner.warning h3{color:var(--amber)}
.banner.notice{border-color:var(--line);background:var(--panel)}
.banner.notice h3{color:var(--secure)}
/* ---- prose (executive summary) ---- */
.prose{font-size:14px}
.prose h2{font-size:18px;margin:26px 0 8px}
.prose h3{font-size:15.5px;margin:20px 0 6px}
.prose p,.prose li{overflow-wrap:anywhere}
.prose ul,.prose ol{padding-left:21px}
.prose pre{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:12px 14px;overflow-x:auto}
.prose code{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.prose pre code{background:none;border:0;padding:0}
.prose table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13px;display:block;overflow-x:auto}
.prose th,.prose td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
.prose blockquote{margin:14px 0;padding:8px 14px;border-left:3px solid var(--line);color:var(--muted)}
/* ---- coverage ---- */
.cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:10px}
.cell{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:13px 15px}
.cell .ct{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.cell .cn{font-size:14.5px;font-weight:600;margin-top:2px}
.cell .cs{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:5px}
.cs.done{color:var(--secure)} .cs.blocked{color:var(--amber)} .cs.missing{color:var(--faint)}
.totals{font-family:var(--mono);font-size:12.5px;color:var(--muted);margin:14px 0 0}
.limits{margin:10px 0 0;color:var(--muted);font-size:13px}
.limits li{margin:3px 0;overflow-wrap:anywhere}
/* ---- findings ---- */
.tier-head{margin:34px 0 4px;font-size:16px}
.tier-def{color:var(--faint);font-size:12.5px;margin:0 0 14px;font-family:var(--mono)}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:20px;margin:0 0 14px}
.card.ruled-out{border-style:dashed;color:var(--muted)}
.card-top{display:flex;flex-wrap:wrap;align-items:center;gap:7px}
.card-title{font-family:var(--mono);font-weight:700;font-size:14.5px;color:var(--fg);overflow-wrap:anywhere}
.card.ruled-out .card-title{color:var(--muted)}
.card-id{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--faint)}
.tier-badge{font-family:var(--mono);font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  padding:2px 8px;border-radius:4px;border:1px solid}
.tier-badge.proven{color:var(--secure);border-color:color-mix(in srgb,var(--secure) 45%,transparent)}
.tier-badge.confirmed{color:var(--secure);border-color:color-mix(in srgb,var(--secure) 30%,transparent)}
.tier-badge.deferred{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 40%,transparent)}
.tier-badge.ruled-out{color:var(--faint);border-color:var(--line)}
.refchip{font-family:var(--mono);font-size:10.5px;padding:2px 7px;border-radius:4px;border:1px solid var(--line);color:var(--muted)}
.ev-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px;margin:13px 0 0}
.no-bundle{font-family:var(--mono);font-size:12px;color:var(--faint);margin:13px 0 0}
.card-foot{font-family:var(--mono);font-size:11.5px;color:var(--faint);margin-top:14px}
/* ---- proof block ---- */
.proof{border:1px solid var(--line);border-radius:6px;margin-top:14px;overflow:hidden}
.proof-head{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
  padding:9px 14px;border-bottom:1px solid var(--line)}
.proof.exec .proof-head{color:var(--secure);background:color-mix(in srgb,var(--secure) 7%,transparent)}
.proof.obs .proof-head{color:var(--muted);background:var(--panel)}
.proof-body{padding:13px 14px}
.proof-body p{margin:0 0 9px;font-size:13.5px}
.marker-line{font-family:var(--mono);font-size:12px;color:var(--muted);overflow-wrap:anywhere}
mark{background:color-mix(in srgb,var(--secure) 35%,transparent);color:var(--fg);padding:0 2px;border-radius:2px}
.steps{font-family:var(--mono);font-size:11.5px;line-height:1.55;background:var(--panel);border:1px solid var(--line);
  border-radius:6px;padding:11px 13px;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px}
.doesnot{color:var(--faint);font-size:12.5px;margin-top:10px}
.reverify{font-family:var(--mono);font-size:12px;background:var(--panel);border:1px solid var(--line);
  border-radius:6px;padding:9px 12px;margin-top:10px;overflow-wrap:anywhere}
/* ---- fix ---- */
.fixblock{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px 16px;margin-top:14px}
.fixblock .fb-head{font-family:var(--mono);font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:7px}
.fixblock .fb-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px}
.retest{font-size:13px;color:var(--muted);margin-top:10px}
.retest strong{color:var(--fg)}
.fixprompt{font-family:var(--mono);font-size:12px;line-height:1.55;background:var(--panel);border:1px solid var(--line);
  border-radius:6px;padding:15px 17px;max-height:430px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.copybtn{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:var(--panel);
  color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:4px 10px;cursor:pointer;margin:0 0 10px}
.copybtn:hover{color:var(--fg);border-color:var(--dim)}
/* ---- activity ---- */
.tblwrap{overflow-x:auto}
table.act{border-collapse:collapse;width:100%;font-size:13px}
table.act th,table.act td{border:1px solid var(--line);padding:7px 11px;text-align:left;vertical-align:top}
table.act th{font-family:var(--mono);font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);background:var(--panel)}
table.act td{font-family:var(--mono);font-size:12.5px}
/* ---- misc ---- */
.allclear{border:1px solid color-mix(in srgb,var(--secure) 40%,transparent);border-radius:8px;padding:22px;text-align:center;margin-top:16px}
.allclear h3{color:var(--secure);margin:0 0 5px;font-size:16.5px}
.allclear p{color:var(--muted);margin:0;font-size:13.5px}
footer.doc{margin-top:52px;padding-top:16px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px}
footer.doc code{color:var(--muted)}
@media (max-width:720px){ .cover-grid{flex-direction:column} .score-block{flex:none;width:100%} }
@media print{
  :root{--bg:#fff;--panel:#f9fafb;--card:#fff;--line:#d4d4d8;--fg:#09090b;--muted:#3f3f46;--faint:#52525b;--dim:#a1a1aa;
    --sev-critical:#dc2626;--sev-high:#e11d48;--sev-medium:#ca8a04;--sev-low:#2563eb;--sev-info:#52525b;--secure:#059669}
  .gauge-arc{stroke:var(--grade-print,var(--grade))}
  body{font-size:11pt}
  .wrap{max-width:none;padding:0}
  .copybtn{display:none}
  .steps,.fixprompt{max-height:none;overflow:visible}
  .card,.proof,.cover,.banner,.cell{break-inside:avoid}
  h2,h3{break-after:avoid}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{margin:1.5cm 2cm}
}
`;
