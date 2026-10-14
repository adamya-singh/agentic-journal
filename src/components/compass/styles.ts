// /compass wears the Horizon Dawn look of Bugs/Features: BF_CSS (tokens, .bf-sky hero, .bf-seg,
// .bf-term night blocks, Instrument Serif) is injected globally by BugsFeaturesProvider, so this
// string only adds the cp-* rules: the hero's status pill and progress track, Focus cards, the
// period timeline, the change log with its diff view, and the period sheet.
// Breakpoints: 640 (phone), 820 (two columns), 1100 (timeline beside the log).
export const CP_CSS = `
.cp-root{--cp-warn:#b45309;--cp-warn-bg:rgba(245,158,11,.14);--cp-hunk:#9bb0d6;
  --cp-add-bg:rgba(45,212,191,.13);--cp-add-ink:#9af0dd;--cp-del-bg:rgba(251,113,133,.15);--cp-del-ink:#ffb8c6}
.dark .cp-root{--cp-warn:#fbbf24;--cp-warn-bg:rgba(251,191,36,.13)}

/* hero */
.cp-hero .bf-hero-in{align-items:flex-start}
.cp-hero-main{flex:1 1 380px;min-width:0;display:grid;gap:9px}
.cp-hero .bf-title{font-size:38px;line-height:1.06;text-wrap:balance;overflow-wrap:anywhere}
.cp-dates{font:11.5px/1.6 var(--bf-mono);color:rgba(230,236,244,.8);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font-variant-numeric:tabular-nums}
.cp-dates b{color:#fff;font-weight:500}
.cp-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font:500 11px var(--bf-mono);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.cp-pill i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.cp-pill[data-status="active"]{background:linear-gradient(180deg,#ffd27a,#ff9a3c);color:#5a2a08}
.cp-pill[data-status="review-due"]{background:rgba(251,191,36,.16);color:#ffd27a;border:1px solid rgba(255,210,122,.6)}
.cp-pill[data-status="review-due"] i{box-shadow:0 0 8px #ffd27a}
@media (prefers-reduced-motion:no-preference){
  .cp-pill[data-status="review-due"] i{animation:cp-pulse 1.6s ease-in-out infinite}
  @keyframes cp-pulse{50%{opacity:.3;transform:scale(.75)}}
}
.cp-pill[data-status="expired"]{border:1px solid rgba(230,236,244,.4);color:rgba(230,236,244,.8)}
.cp-pill[data-status="upcoming"]{border:1px solid rgba(255,255,255,.8);color:#fff}
.cp-pill[data-status="closed"]{background:rgba(11,23,48,.5);color:rgba(230,236,244,.85);border:1px solid rgba(255,255,255,.16)}
.cp-track{position:relative;height:6px;border-radius:999px;background:rgba(255,255,255,.18);max-width:560px;margin-top:4px}
.cp-track>b{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,#ffd27a,#ff9a3c);box-shadow:0 0 12px rgba(255,154,60,.6)}
.cp-track>i{position:absolute;top:-4px;width:2px;height:14px;background:#fff6ec;border-radius:1px;transform:translateX(-1px)}
.cp-track-l{display:flex;justify-content:space-between;gap:10px;max-width:560px;font:11px var(--bf-mono);color:rgba(230,236,244,.78);font-variant-numeric:tabular-nums}
.cp-track-l b{color:#fff;font-weight:500}
.cp-hero-side{margin-left:auto;display:grid;gap:8px;justify-items:end;align-self:flex-start}
.cp-hero .bf-tally{text-align:right;padding-top:0}
.cp-hero .bf-tally code{font:inherit;color:#ffd27a}
.cp-hero-acts{flex-basis:100%;display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:relative}
.cp-ghost{height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(11,23,48,.35);color:#fff6ec;font-size:12.5px;font-weight:500;display:inline-flex;align-items:center;gap:6px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.cp-ghost:hover{background:rgba(11,23,48,.55)}
.cp-ghost:disabled{opacity:.6;cursor:default}
.cp-ghost svg{width:14px;height:14px}
.cp-ghost.busy svg{animation:cp-spin 1s linear infinite}
@keyframes cp-spin{to{transform:rotate(360deg)}}
@media (max-width:640px){
  .cp-hero .bf-title{font-size:30px}
  .cp-hero-side{margin-left:0;justify-items:start;flex-basis:100%}
  .cp-hero .bf-tally{text-align:left}
}

/* markdown */
.cp-md{font-size:14.5px;line-height:1.6;color:var(--bf-ink-2);overflow-wrap:anywhere;min-width:0}
.cp-md>:first-child{margin-top:0}.cp-md>:last-child{margin-bottom:0}
.cp-md p{margin:0 0 10px}
.cp-md ul,.cp-md ol{margin:0 0 10px;padding-left:22px}
.cp-md ul{list-style:disc}
.cp-md ol{list-style:decimal}
.cp-md ul ul{list-style:circle}
.cp-md li{margin:4px 0}
.cp-md li::marker{color:var(--bf-sun-3)}
.cp-md strong{color:var(--bf-ink);font-weight:600}
.cp-md h1,.cp-md h2,.cp-md h3,.cp-md h4{font:italic 400 1.25em/1.2 var(--bf-serif);color:var(--bf-ink);margin:16px 0 8px}
.cp-md h1{font-size:1.6em}.cp-md h2{font-size:1.4em}
.cp-md a{color:var(--bf-ink);text-decoration:underline;text-underline-offset:2px;text-decoration-color:var(--bf-sun-3)}
.cp-md code{font:12.5px var(--bf-mono);background:var(--bf-rule);padding:1px 5px;border-radius:5px;color:var(--bf-ink)}
.cp-md pre{margin:0 0 10px;padding:12px 14px;border-radius:12px;background:var(--bf-term);color:var(--bf-term-ink);overflow-x:auto;font:12.5px/1.6 var(--bf-mono)}
.cp-md pre code{background:none;padding:0;color:inherit;font-size:inherit}
.cp-md blockquote{margin:0 0 10px;padding:4px 14px;border-left:3px solid var(--bf-sun-3);color:var(--bf-ink-2)}
.cp-md table{border-collapse:collapse;font-size:13px;width:100%}
.cp-md th,.cp-md td{border:1px solid var(--bf-rule-2);padding:6px 8px;text-align:left;vertical-align:top}
.cp-md hr{border:0;border-top:1px solid var(--bf-rule-2);margin:14px 0}
.cp-md input[type=checkbox]{margin-right:6px}

/* sections */
.cp-sec{display:grid;gap:12px}
.cp-sec-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.cp-sec-head small{font:11px var(--bf-mono);color:var(--bf-ink-3);letter-spacing:.02em}
.cp-lead{max-width:76ch}
.cp-lead .cp-md{font:italic 400 19px/1.5 var(--bf-serif);color:var(--bf-ink)}
.cp-lead .cp-md strong{font-weight:400;color:var(--bf-sun-3)}
.cp-focus{display:grid;gap:14px}
@media (min-width:820px){.cp-focus{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}}
.cp-focus-card{position:relative;border-radius:16px;background:var(--bf-card);box-shadow:var(--bf-card-shadow);padding:18px 18px 16px;display:grid;gap:8px;min-width:0;overflow:hidden;align-content:start}
.cp-focus-card::after{content:"";position:absolute;right:-40px;bottom:-50px;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,rgba(255,154,60,.2),transparent 70%);pointer-events:none}
.cp-num{font:400 40px/1 var(--bf-serif);color:var(--bf-sun-3);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.cp-focus-card .cp-md{font-size:14px}
.cp-grid2{display:grid;gap:14px}
@media (min-width:820px){.cp-grid2{grid-template-columns:1fr 1fr}}
.cp-card{border-radius:16px;background:var(--bf-card);box-shadow:var(--bf-card-shadow);padding:16px 18px;display:grid;gap:10px;min-width:0;align-content:start}
.cp-card .bf-h{font-size:21px}
.cp-card.wide{grid-column:1/-1}
.cp-agents summary{list-style:none;cursor:pointer}
.cp-agents summary::-webkit-details-marker{display:none}
.cp-agents .bf-termbar{padding:11px 14px;flex-wrap:nowrap}
.cp-agents .bf-termbar .who{white-space:nowrap;flex:none}
.cp-agents .bf-termbar .hint:not(.r){flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-agents .bf-termbar .r{flex:none}
.cp-agents .bf-termbar .chev{display:inline-block;transition:transform .2s;color:var(--bf-sun-2)}
.cp-agents[open] .bf-termbar .chev{transform:rotate(90deg)}
.cp-agents .bf-termbar .hint{color:var(--bf-term-dim)}
.cp-term-body{position:relative;padding:12px 16px 16px}
.cp-term-body .cp-md{font:12.5px/1.65 var(--bf-mono);color:var(--bf-term-ink)}
.cp-term-body .cp-md li::marker{color:var(--bf-sun-2)}
.cp-term-body .cp-md strong{color:#fff}
.cp-term-body .cp-md code{background:rgba(255,255,255,.08);color:var(--bf-sun-1)}
.cp-term-body .cp-md a{color:var(--bf-sun-1)}
.cp-problems{display:flex;gap:9px;align-items:flex-start;padding:10px 14px;border-radius:12px;background:var(--cp-warn-bg);color:var(--cp-warn);font:12.5px/1.5 var(--bf-sans)}
.cp-problems svg{flex:none;width:16px;height:16px;margin-top:2px}
.cp-problems ul{margin:0;padding-left:16px}
.cp-problems li{margin:1px 0}
.cp-note{font:11.5px/1.5 var(--bf-mono);color:var(--bf-ink-3);overflow-wrap:anywhere}
.cp-note.warn{color:var(--cp-warn)}

/* long-term */
.cp-mirror{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:11.5px var(--bf-mono);color:var(--bf-ink-3)}
.cp-mirror i{width:7px;height:7px;border-radius:50%;background:var(--bf-feat);flex:none}
.cp-mirror.stale{color:var(--cp-warn)} .cp-mirror.stale i{background:var(--cp-warn)}
.cp-lt{display:grid;gap:14px}
@media (min-width:820px){.cp-lt{grid-template-columns:1fr 1fr}.cp-lt>:last-child:nth-child(odd){grid-column:1/-1}}
@media (min-width:1100px){.cp-lt{grid-template-columns:repeat(3,1fr)}.cp-lt>:last-child:nth-child(odd){grid-column:auto}}
.cp-lt-card .cp-md blockquote{font:italic 400 17px/1.45 var(--bf-serif);color:var(--bf-ink);border-color:var(--bf-sun-2)}
.cp-lt-card .cp-md{font-size:13.5px}
.cp-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--bf-rule-2);font:500 11px var(--bf-mono);color:var(--bf-ink-2);background:var(--bf-paper);white-space:nowrap}
.cp-chip.file{color:var(--bf-ink);border-color:var(--bf-sun-3);background:var(--bf-glow)}
.cp-chip.warn{color:var(--cp-warn);border-color:currentColor;background:var(--cp-warn-bg)}
.cp-chip.off{opacity:.45;border-style:dashed}
.cp-chiprow{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.cp-chiprow .r{margin-left:auto}
.cp-path{font:11px var(--bf-mono);color:var(--bf-ink-3);overflow-wrap:anywhere}

/* history: timeline beside the change log */
.cp-history{display:grid;gap:18px;align-items:start}
@media (min-width:1100px){.cp-history{grid-template-columns:5fr 7fr}}
.cp-history.single{grid-template-columns:1fr}
.cp-tl{list-style:none;margin:0;padding:0 0 0 20px;position:relative;display:grid;gap:12px}
.cp-tl::before{content:"";position:absolute;left:5px;top:10px;bottom:10px;width:2px;background:var(--bf-rule-2);border-radius:1px}
.cp-tl-item{position:relative}
.cp-tl-item::before{content:"";position:absolute;left:-20px;top:17px;width:12px;height:12px;border-radius:50%;background:var(--bf-card);border:2px solid var(--bf-rule-2);box-sizing:border-box}
.cp-tl-item.current::before{border-color:var(--bf-sun-3);background:radial-gradient(circle,#fff6d8,#ff9a3c);box-shadow:0 0 10px rgba(255,154,60,.6)}
.cp-tl-item.draft::before{border-color:var(--bf-ink-3);background:transparent}
.cp-tl-item.closed::before{background:var(--bf-ink-3);border-color:var(--bf-ink-3)}
.cp-tl-card{width:100%;text-align:left;border:0;border-radius:16px;background:var(--bf-card);box-shadow:var(--bf-card-shadow);padding:14px 16px;display:grid;gap:8px;min-width:0;transition:transform .18s,box-shadow .18s;color:inherit}
button.cp-tl-card:hover{transform:translateY(-1px);box-shadow:var(--bf-card-shadow),0 0 0 1px var(--bf-rule-2)}
.cp-tl-card.draft{background:transparent;border:1.5px dashed var(--bf-rule-2);box-shadow:none}
.cp-tl-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:11px var(--bf-mono);color:var(--bf-ink-3)}
.cp-tl-top .r{margin-left:auto}
.cp-tl-card h3{margin:0;font-size:15px;font-weight:600;line-height:1.35;color:var(--bf-ink);text-wrap:pretty;overflow-wrap:anywhere}
.cp-tl-card.draft h3{color:var(--bf-ink-2)}
.cp-tl-dates{font:11.5px var(--bf-mono);color:var(--bf-ink-2);font-variant-numeric:tabular-nums}
.cp-tl-chips{display:flex;gap:6px;flex-wrap:wrap}
.cp-tl-chips .cp-chip{height:22px;font-size:10.5px}
.cp-verdict{font-size:12.5px;color:var(--bf-ink-2)}
.cp-verdict b{font-weight:600;color:var(--bf-ink)}
.cp-state{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:999px;font:500 10.5px var(--bf-mono);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.cp-state[data-state="current"]{background:linear-gradient(180deg,#ffd27a,#ff9a3c);color:#5a2a08}
.cp-state[data-state="closed"]{background:var(--bf-rule);color:var(--bf-ink-2)}
.cp-state[data-state="unfinished"]{border:1px dashed var(--bf-ink-3);color:var(--bf-ink-3)}
.cp-state[data-state="draft"]{border:1px solid var(--bf-ink-3);color:var(--bf-ink-2)}
.cp-state[data-state="approved"]{background:color-mix(in srgb,var(--bf-feat) 18%,transparent);color:var(--bf-feat)}
.cp-await{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--bf-ink-2)}
.cp-await i{width:7px;height:7px;border-radius:50%;background:var(--cp-warn);box-shadow:0 0 8px var(--cp-warn);flex:none}
.cp-await.ok i{background:var(--bf-feat);box-shadow:none}

/* change log */
.cp-log{display:grid;gap:12px;min-width:0}
.cp-log-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cp-log-head .bf-filters{margin-left:auto}
.cp-commits{display:grid;gap:6px}
.cp-commit{border-radius:14px;background:var(--bf-card);box-shadow:var(--bf-card-shadow);overflow:hidden;min-width:0}
.cp-commit-row{width:100%;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 10px;align-items:center;padding:10px 14px;border:0;background:none;text-align:left;color:inherit}
.cp-commit-row:hover{background:color-mix(in srgb,var(--bf-rule) 55%,transparent)}
.cp-commit-row[aria-expanded="true"]{background:color-mix(in srgb,var(--bf-rule) 55%,transparent)}
.cp-commit-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font:11px var(--bf-mono);color:var(--bf-ink-3)}
.cp-author{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font:500 10.5px var(--bf-mono);letter-spacing:.04em;white-space:nowrap}
.cp-author[data-kind="openclaw"]{background:linear-gradient(180deg,#ffd27a,#ff9a3c);color:#5a2a08}
.cp-author[data-kind="adamya"]{background:var(--bf-ink);color:var(--bf-paper)}
.cp-author[data-kind="compass-sync"]{background:var(--bf-rule);color:var(--bf-ink-3)}
.cp-author[data-kind="other"]{border:1px solid var(--bf-rule-2);color:var(--bf-ink-2)}
.cp-kind{font:500 10.5px var(--bf-mono);color:var(--bf-ink-3);border:1px solid var(--bf-rule-2);border-radius:999px;padding:2px 7px;letter-spacing:.04em;white-space:nowrap}
.cp-kind[data-kind="pulse"]{color:var(--bf-sun-3);border-color:var(--bf-sun-3)}
.cp-kind[data-kind="period"],.cp-kind[data-kind="draft"]{color:var(--bf-feat);border-color:var(--bf-feat)}
.cp-kind[data-kind="chat"]{color:var(--bf-ink);border-color:var(--bf-ink-2)}
.cp-subject{font-size:14px;font-weight:500;color:var(--bf-ink);min-width:0;overflow-wrap:anywhere}
.cp-when{font:11px/1.5 var(--bf-mono);color:var(--bf-ink-3);white-space:nowrap;text-align:right}
.cp-when code{display:block;color:var(--bf-ink-2);font:inherit}
@media (max-width:640px){
  .cp-commit-row{grid-template-columns:minmax(0,1fr) auto}
  .cp-commit-meta{grid-column:1/-1}
}
.cp-commit-body{padding:0 14px 14px}
.cp-more{justify-self:center}

/* diff */
.cp-diff .bf-termbar .n{color:var(--bf-term-ink)}
.cp-diff .add{color:var(--cp-add-ink)} .cp-diff .del{color:var(--cp-del-ink)}
.cp-diff-body{margin:0;padding:10px 0 12px;font:12px/1.55 var(--bf-mono);color:var(--bf-term-ink);overflow:auto;max-height:520px;position:relative;tab-size:4}
.cp-diff-body>div{padding:0 14px;white-space:pre;min-width:max-content}
.cp-diff-body .f{color:var(--bf-sun-2);font-weight:600;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.07)}
.cp-diff-body>.f:first-child{margin-top:0;padding-top:0;border-top:0}
.cp-diff-body .m{color:var(--bf-term-dim)}
.cp-diff-body .h{color:var(--cp-hunk);background:rgba(155,176,214,.08)}
.cp-diff-body .a{background:var(--cp-add-bg);color:var(--cp-add-ink)}
.cp-diff-body .d{background:var(--cp-del-bg);color:var(--cp-del-ink)}
.cp-diff-body .cut{color:var(--bf-term-dim);font-style:italic;padding-top:8px}
.cp-badge{font:500 10px var(--bf-mono);padding:2px 7px;border-radius:999px;background:rgba(251,191,36,.18);color:#ffd27a;white-space:nowrap}
.cp-copy{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;border:0;background:rgba(255,255,255,.08);color:var(--bf-term-ink);font:500 11px var(--bf-mono);padding:3px 9px;border-radius:999px}
.cp-copy:hover{background:rgba(255,255,255,.16)}
.cp-diff-empty{padding:14px;font:12px var(--bf-mono);color:var(--bf-term-dim)}

/* period sheet (rendered in a portal, so it carries bf-root itself) */
.cp-scrim{position:fixed;inset:0;z-index:10010;background:rgba(17,24,39,.28);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.dark .cp-scrim{background:rgba(0,0,0,.5)}
.cp-sheet{position:fixed;top:10px;right:10px;bottom:10px;width:min(680px,calc(100% - 20px));z-index:10011;background:var(--bf-paper);border-radius:18px;overflow:hidden;box-shadow:var(--bf-shadow);display:flex;flex-direction:column;color:var(--bf-ink);font-family:var(--bf-sans)}
.cp-sheet .bf-sky{padding:calc(16px + env(safe-area-inset-top,0px)) 18px 14px 22px}
.cp-sheet .bf-sun{right:30px;bottom:-60px;width:110px;height:110px}
.cp-sheet .bf-title{font-size:27px;line-height:1.12;overflow-wrap:anywhere;text-wrap:balance}
.cp-sheet .bf-skytop{align-items:flex-start}
.cp-sheet .bf-skytop>div:first-child{min-width:0;flex:1;display:grid;gap:6px}
.cp-sheet .bf-seg{position:relative;margin-top:16px}
.cp-sheet .bf-seg button:disabled{opacity:.38;cursor:default}
.cp-sheet-body{flex:1;overflow-y:auto;padding:18px 22px 24px;display:grid;gap:14px;align-content:start}
@media (max-width:640px){.cp-sheet{top:0;right:0;bottom:0;width:100%;border-radius:0}.cp-sheet-body{padding-inline:16px}}
.cp-log-entry{border-radius:14px;background:var(--bf-card);box-shadow:var(--bf-card-shadow);padding:14px 16px;display:grid;gap:8px;min-width:0}
.cp-log-entry .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:11px var(--bf-mono);color:var(--bf-ink-3)}
.cp-log-entry .top b{color:var(--bf-ink);font-weight:500}
.cp-log-entry .ttl{font-size:14px;font-weight:600;color:var(--bf-ink)}
.cp-callout{border-radius:14px;padding:12px 16px;background:var(--bf-glow);color:var(--bf-ink);display:grid;gap:2px}
.cp-callout small{font:11px var(--bf-mono);color:var(--bf-ink-3);letter-spacing:.06em;text-transform:uppercase}
.cp-callout b{font:italic 400 22px/1.15 var(--bf-serif)}
.cp-callout.muted{background:var(--bf-rule)}
.cp-sheet .bf-empty{padding:28px 10px}
`;
