/**
 * The unified report stylesheet — a single inline <style> block, no external
 * requests, no web fonts (system stacks only; the display/mono faces named
 * first are used when locally present, never fetched).
 *
 * Screen: the locked glass-on-zinc recipe (html-report-design skill):
 * translucent white fills over a deep zinc base with a radial top
 * falloff, 1px hairline borders, an inset top highlight, radius 16px
 * panels / 12px cards, the 4/8/12/16/24/32 spacing scale, and the
 * severity/grade tokens from tokens.ts. backdrop-filter blur applies
 * only to the bounded-count containers (cover, banner, panels, wells)
 * — finding cards and coverage cells (unbounded in number) carry the
 * glass fills/highlights without blur, so a long report never stacks
 * dozens of blurred surfaces (the speed guardrail). Motion is the
 * skill's set (gauge sweep, severity-bar growth, card rise) on the
 * house curve, fully off under prefers-reduced-motion, and print
 * forces the light final states with glass flattened.
 * Print: light theme forced, token vars swapped to their
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
  --glass-hi:rgba(255,255,255,.055); --glass-lo:rgba(255,255,255,.02);
  --glass-line:rgba(255,255,255,.1); --inset:rgba(255,255,255,.05);
  --ease:cubic-bezier(.22,1,.36,1);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:radial-gradient(1200px 620px at 50% -120px,#17171a,var(--bg) 58%);color:var(--fg);font:14px/1.6 var(--sans)}
.wrap{max-width:1024px;margin:0 auto;padding:32px 24px 64px}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
h1,h2,h3{font-family:var(--sans);letter-spacing:-.01em}
.sec-title{font-size:17px;margin:32px 0 8px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.sec-sub{color:var(--muted);font-size:13px;margin:0 0 16px}
code{font-family:var(--mono);font-size:.92em;overflow-wrap:anywhere}
a{color:var(--brand)}
/* ---- cover ---- */
.cover{background:linear-gradient(180deg,var(--glass-hi),var(--glass-lo));border:1px solid var(--glass-line);border-radius:16px;padding:24px 32px;
  box-shadow:inset 0 1px 0 var(--inset),0 24px 48px rgba(0,0,0,.45);backdrop-filter:blur(14px) saturate(170%);-webkit-backdrop-filter:blur(14px) saturate(170%)}
.cover-grid{display:flex;gap:32px;align-items:flex-start;flex-wrap:wrap}
.cover-meta{flex:1 1 420px;min-width:300px}
.target{font-family:var(--mono);font-size:28px;line-height:1.25;font-weight:700;margin:8px 0 2px;overflow-wrap:anywhere;user-select:all}
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
.gauge-arc{stroke:var(--grade);stroke-dasharray:440;animation:sweep .9s var(--ease) both}
@keyframes sweep{from{stroke-dashoffset:440}to{stroke-dashoffset:0}}
.gauge-num{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.gauge-score{font-family:var(--mono);font-size:42px;font-weight:700;line-height:1}
.gauge-score small{font-size:15px;color:var(--faint);font-weight:400}
.gauge-grade{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:5px}
/* ---- severity bar + chips ---- */
.sevbar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--line);margin:12px auto 0;max-width:230px}
.sevbar div{height:100%;transform-origin:left;animation:grow .6s var(--ease) both}
.sevbar div:nth-child(2){animation-delay:.08s} .sevbar div:nth-child(3){animation-delay:.16s}
.sevbar div:nth-child(4){animation-delay:.24s} .sevbar div:nth-child(5){animation-delay:.32s}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
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
.banner{border:1px solid;border-radius:16px;padding:16px 24px;margin-top:16px;
  box-shadow:inset 0 1px 0 var(--inset);backdrop-filter:blur(14px) saturate(170%);-webkit-backdrop-filter:blur(14px) saturate(170%)}
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
.prose pre{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 16px;overflow-x:auto}
.prose code{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.prose pre code{background:none;border:0;padding:0}
.prose table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13px;display:block;overflow-x:auto}
.prose th,.prose td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
.prose blockquote{margin:14px 0;padding:8px 14px;border-left:3px solid var(--line);color:var(--muted)}
/* ---- coverage ---- */
.cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px}
.cell{background:linear-gradient(180deg,var(--glass-hi),var(--glass-lo));border:1px solid var(--glass-line);border-radius:12px;padding:12px 16px;
  box-shadow:inset 0 1px 0 var(--inset)}
.cell .ct{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.cell .cn{font-size:14.5px;font-weight:600;margin-top:2px}
.cell .cs{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:5px}
.cs.done{color:var(--secure)} .cs.blocked{color:var(--amber)} .cs.missing{color:var(--faint)}
.totals{font-family:var(--mono);font-size:12.5px;color:var(--muted);margin:14px 0 0}
.limits{margin:10px 0 0;color:var(--muted);font-size:13px}
.limits li{margin:3px 0;overflow-wrap:anywhere}
/* ---- findings ---- */
.tier-head{margin:32px 0 4px;font-size:16px}
.sub-title{margin:24px 0 8px;font-size:15px}
.tier-def{color:var(--faint);font-size:12.5px;margin:0 0 16px;font-family:var(--mono)}
.card{background:linear-gradient(180deg,var(--glass-hi),var(--glass-lo));border:1px solid var(--glass-line);border-radius:12px;padding:24px;margin:0 0 16px;
  box-shadow:inset 0 1px 0 var(--inset),0 12px 28px rgba(0,0,0,.35);animation:rise .5s var(--ease) both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
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
.proof{border:1px solid var(--glass-line);border-radius:12px;margin-top:16px;overflow:hidden}
.proof-head{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
  padding:9px 14px;border-bottom:1px solid var(--line)}
.proof.exec .proof-head{color:var(--secure);background:color-mix(in srgb,var(--secure) 7%,transparent)}
.proof.obs .proof-head{color:var(--muted);background:var(--panel)}
.proof-body{padding:13px 14px}
.proof-body p{margin:0 0 9px;font-size:13.5px}
.marker-line{font-family:var(--mono);font-size:12px;color:var(--muted);overflow-wrap:anywhere}
mark{background:color-mix(in srgb,var(--secure) 35%,transparent);color:var(--fg);padding:0 2px;border-radius:2px}
.steps{font-family:var(--mono);font-size:11.5px;line-height:1.55;background:var(--panel);border:1px solid var(--line);
  border-radius:10px;padding:12px;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px}
.doesnot{color:var(--faint);font-size:12.5px;margin-top:8px}
.reverify{font-family:var(--mono);font-size:12px;background:var(--panel);border:1px solid var(--line);
  border-radius:10px;padding:8px 12px;margin-top:8px;overflow-wrap:anywhere}
/* ---- fix ---- */
.fixblock{background:linear-gradient(180deg,var(--glass-hi),var(--glass-lo));border:1px solid var(--glass-line);border-radius:12px;padding:16px;margin-top:16px;
  box-shadow:inset 0 1px 0 var(--inset)}
.fixblock .fb-head{font-family:var(--mono);font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:7px}
.fixblock .fb-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px}
.fixblock.impactblock{border-left:3px solid var(--amber)}
.retest{font-size:13px;color:var(--muted);margin-top:10px}
.retest strong{color:var(--fg)}
.fixprompt{font-family:var(--mono);font-size:12px;line-height:1.55;background:var(--panel);border:1px solid var(--line);
  border-radius:10px;padding:16px;max-height:430px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.copybtn{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:var(--panel);
  color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:4px 10px;cursor:pointer;margin:0 0 10px}
.copybtn:hover{color:var(--fg);border-color:var(--dim)}
/* ---- activity ---- */
.tblwrap{overflow-x:auto}
table.act{border-collapse:collapse;width:100%;font-size:13px}
table.act th,table.act td{border:1px solid var(--line);padding:7px 11px;text-align:left;vertical-align:top}
table.act th{font-family:var(--mono);font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);background:var(--panel)}
table.act td{font-family:var(--mono);font-size:12.5px}
/* ---- detail sections (Q-REPORT-DETAIL) ---- */
.delta-line{font-family:var(--mono);font-size:12.5px;color:var(--muted);margin-top:6px}
.d-good{color:var(--secure)} .d-bad{color:var(--red)} .d-flat{color:var(--muted)}
.breakdown{background:linear-gradient(180deg,var(--glass-hi),var(--glass-lo));border:1px solid var(--glass-line);border-radius:16px;padding:16px 24px;
  box-shadow:inset 0 1px 0 var(--inset);backdrop-filter:blur(14px) saturate(170%);-webkit-backdrop-filter:blur(14px) saturate(170%)}
.breakdown p{margin:0 0 8px;font-size:13.5px}
.breakdown p:last-child{margin-bottom:0}
.panelbox{background:linear-gradient(180deg,var(--glass-hi),var(--glass-lo));border:1px solid var(--glass-line);border-radius:16px;padding:16px 24px;
  box-shadow:inset 0 1px 0 var(--inset);backdrop-filter:blur(14px) saturate(170%);-webkit-backdrop-filter:blur(14px) saturate(170%)}
.panelbox p{margin:0;color:var(--muted);font-size:13.5px}
.diff-counts{font-family:var(--mono);font-size:13px;margin:0 0 6px}
.diff-group{font-size:14.5px;margin:16px 0 6px}
.diff-list{margin:0;padding-left:0;list-style:none}
.diff-list li{margin:5px 0;font-size:13.5px;display:flex;flex-wrap:wrap;align-items:center;gap:7px}
.mk{font-family:var(--mono);font-weight:700;font-size:12px;min-width:14px}
.mk-new{color:var(--red)} .mk-resolved{color:var(--secure)}
.mk-worsened{color:var(--amber)} .mk-improved{color:var(--secure)}
.diff-note{color:var(--faint);font-size:12.5px}
.area-rows{margin:10px 0 0;padding-left:0;list-style:none}
.area-rows li{margin:5px 0;font-size:13px;display:flex;flex-wrap:wrap;align-items:center;gap:7px}
.area-rows a{color:var(--fg);text-decoration:none;border-bottom:1px solid var(--line)}
.area-rows a:hover{border-bottom-color:var(--dim)}
.area-count{font-family:var(--mono);font-size:12px;color:var(--muted);margin-top:4px}
.deferred-line{color:var(--muted);font-size:13px;margin:12px 0 0}
ol.priority{margin:0;padding-left:0;list-style:none;counter-reset:pri}
ol.priority li{margin:0 0 10px;font-size:13.5px;display:flex;flex-wrap:wrap;align-items:baseline;gap:7px}
.pri-rank{font-family:var(--mono);font-weight:700;color:var(--muted);min-width:26px}
.pri-fix{color:var(--muted)}
.pillar-status{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:5px}
.pillar-status.noarm,.pillar-status.nodata{color:var(--faint)}
.pillar-status.notcovered{color:var(--amber)}
.pillar-status.secure{color:var(--secure)}
.pillar-status.findings,.pillar-status.mapped{color:var(--fg)}
.pillar-reason{color:var(--muted);font-size:12.5px;margin-top:6px}
.pillar-foot{font-family:var(--mono);font-size:11.5px;color:var(--faint);margin-top:8px}
.pillar .sevbar{margin:10px 0 0;max-width:none}
.wells{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.well{background:linear-gradient(180deg,var(--glass-hi),var(--glass-lo));border:1px solid var(--glass-line);border-radius:12px;padding:16px;
  box-shadow:inset 0 1px 0 var(--inset);backdrop-filter:blur(14px) saturate(170%);-webkit-backdrop-filter:blur(14px) saturate(170%)}
.well h3{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);margin:0 0 10px}
.wrow{display:flex;gap:12px;font-size:13px;margin:5px 0}
.wrow dt{color:var(--faint);flex:0 0 118px;font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;padding-top:1px}
.wrow dd{margin:0;overflow-wrap:anywhere}
/* ---- misc ---- */
.allclear{border:1px solid color-mix(in srgb,var(--secure) 40%,transparent);border-radius:16px;padding:24px;text-align:center;margin-top:16px}
.allclear h3{color:var(--secure);margin:0 0 4px;font-size:16.5px}
.allclear p{color:var(--muted);margin:0;font-size:13.5px}
footer.doc{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px}
footer.doc code{color:var(--muted)}
@media (max-width:720px){ .cover-grid{flex-direction:column} .score-block{flex:none;width:100%} .wells{grid-template-columns:1fr} }
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
}
@media print{
  :root{--bg:#fff;--panel:#f9fafb;--card:#fff;--line:#d4d4d8;--fg:#09090b;--muted:#3f3f46;--faint:#52525b;--dim:#a1a1aa;
    --sev-critical:#dc2626;--sev-high:#e11d48;--sev-medium:#ca8a04;--sev-low:#2563eb;--sev-info:#52525b;--secure:#059669}
  .gauge-arc{stroke:var(--grade-print,var(--grade));stroke-dasharray:none;animation:none}
  .sevbar div,.card{animation:none}
  body{font-size:11pt;background:#fff}
  .cover,.card,.cell,.panelbox,.breakdown,.well,.banner,.fixblock{background:#fff;background-image:none;backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:none;border-color:#d4d4d8}
  .wrap{max-width:none;padding:0}
  .copybtn{display:none}
  .steps,.fixprompt{max-height:none;overflow:visible}
  .card,.proof,.cover,.banner,.cell,.panelbox,.breakdown,.well{break-inside:avoid}
  h2,h3{break-after:avoid}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{margin:1.5cm 2cm}
}
`;
