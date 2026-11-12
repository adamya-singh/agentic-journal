// The Overview's own Mission rules (mockup B, "Readout"), layered on MISSION_JOBS_CSS.
// The overview primitives carry ov-* marker classes next to their Tailwind classes:
// these unlayered rules win inside .mi, while the detail modal (outside .mi) keeps
// the site theme.
export const OVERVIEW_CSS = `
.mi.ov{overflow:clip}
.mi .ov-top-r{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;font:11.5px var(--mono);color:var(--dim)}
.mi .ov-refresh{display:inline-flex;gap:6px;align-items:center;font:11.5px var(--mono);color:var(--dim);padding:6px 8px;border-radius:10px}
.mi .ov-refresh:hover{color:var(--ink);background:var(--hover)}
/* filter strip */
.mi .ov-filters{position:relative;z-index:20;display:grid;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line);background:rgba(2,5,11,.86);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
@media(min-width:768px){.mi .ov-filters{position:sticky;top:0}}
@media(min-width:1100px){.mi .ov-filters{padding:12px 28px}}
.mi .ov-frow{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center}
.mi .ov-pf{display:inline-flex;align-items:center;gap:8px;border-radius:12px;padding:3px 4px 3px 12px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line);font:600 10px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim);max-width:100%}
.mi .ov-pf:focus-within{box-shadow:inset 0 0 0 1px var(--em)}
.mi .ov-pf select,.mi .ov-pf input{min-height:30px;min-width:0;border:0;background:transparent;color:var(--ink);font:600 13px var(--sans);letter-spacing:0;text-transform:none;padding:2px 8px 2px 2px;outline:none;color-scheme:dark}
.mi .ov-pf select option{background:#081325;color:var(--ink)}
.mi .ov-pf.ov-q{flex:1 1 200px;max-width:340px;padding-left:12px}
.mi .ov-pf.ov-q input{width:100%}
.mi .ov-scope{font:11.5px var(--mono);color:var(--dim)}
.mi .ov-scope b{color:var(--ink);font-weight:600}
/* primitives inside .mi */
.mi .ov-card{background:var(--glass);border:1px solid var(--line);border-radius:18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05);overflow:visible}
.mi .ov-ch{border:0;padding:18px 20px 6px;gap:10px}
.mi .ov-ic{display:none}
.mi .ov-h{font:400 28px/1.05 var(--serif);color:var(--ink);letter-spacing:-.01em}
.mi .ov-sub{font:11.5px/1.5 var(--mono);color:var(--dim);margin-top:6px}
.mi .ov-band{border:0;border-radius:16px;margin:0 0 4px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line)}
.mi .ov-band-sky{background:color-mix(in srgb,var(--em) 6%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--em) 28%,transparent)}
.mi .ov-band-red{background:color-mix(in srgb,var(--c-reject) 10%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c-reject) 40%,transparent)}
.mi .ov-band-amber{background:color-mix(in srgb,var(--now) 8%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--now) 40%,transparent)}
.mi .ov-pill{--k:var(--ink2);background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--k) 55%,transparent);color:var(--k);border-radius:6px;font:600 10.5px/1.6 var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:2px 8px}
.mi .ov-t-indigo,.mi .ov-t-sky{--k:var(--em)}.mi .ov-t-emerald{--k:var(--c-tech)}.mi .ov-t-amber{--k:var(--now)}.mi .ov-t-violet{--k:var(--c-screen)}
.mi .ov-t-teal{--k:var(--c-offer)}.mi .ov-t-red{--k:var(--c-reject)}.mi .ov-t-blue{--k:var(--c-ml)}.mi .ov-t-neutral{--k:var(--ink2)}
.mi .ov-seg{display:inline-flex;flex-wrap:wrap;border:0;border-radius:999px;padding:3px;gap:2px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line);overflow:visible}
.mi .ov-seg>button{height:auto;min-height:28px;border-radius:999px;padding:4px 12px;font-weight:600;font-size:12.5px;color:var(--dim);background:transparent;box-shadow:none}
.mi .ov-seg>button:hover{color:var(--ink);background:transparent}
.mi .ov-seg>button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.mi .ov-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:32px;border-radius:12px;padding:5px 12px;font-weight:600;font-size:12.5px;white-space:nowrap;border:1px solid var(--line2);color:var(--ink);background:var(--glass2)}
.mi .ov-btn:hover{border-color:var(--em);background:var(--hover)}
.mi .ov-btn:disabled{opacity:.5;cursor:not-allowed}
.mi .ov-btn-primary{background:var(--em);color:#021018;border-color:transparent}
.mi .ov-btn-primary:hover{background:#a6edff}
.mi .ov-btn-ghost{border-color:transparent;background:none;color:var(--em);padding:5px 8px}
.mi .ov-btn-ghost:hover{background:var(--hover);border-color:transparent}
.mi .ov-btn-amber{background:var(--now);color:#1a0f00;border-color:transparent}
.mi .ov-btn-amber:hover{background:#ffc874;border-color:transparent}
.mi .ov-btn-sky{color:var(--em);border-color:color-mix(in srgb,var(--em) 45%,transparent)}
.mi .ov-btn-icon{width:36px;padding:0;border-color:transparent;background:none;color:var(--dim)}
.mi .ov-link{color:var(--em);font-weight:500;text-align:left}
.mi .ov-link:hover{text-decoration:underline}
.mi .ov-empty{color:var(--dim);font-size:13.5px}
.mi .ov-lab{font:600 10.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.mi .ov-info{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;color:var(--dim)}
.mi .ov-info:hover{color:var(--ink);background:var(--hover)}
.mi .ov-note{background:#071225;border:1px solid var(--line2);color:var(--ink2);font:12.5px/1.55 var(--sans);letter-spacing:0;text-transform:none;border-radius:12px;padding:12px 14px;box-shadow:0 24px 60px -20px #000}
.mi .ov-note button{color:var(--dim);width:24px;height:24px;display:inline-grid;place-items:center;border-radius:6px}
.mi .ov-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 4px 3px 12px;font:500 12px var(--sans);color:var(--em);background:var(--sel);border:0;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--em) 50%,transparent)}
.mi .ov-chip button{width:20px;height:20px;display:inline-grid;place-items:center;border-radius:50%}
.mi .ov-chip button:hover{background:var(--hover)}
.mi .ov-ctl{background:rgba(0,0,0,.35);border:1px solid var(--line2);border-radius:10px;color:var(--ink);color-scheme:dark}
/* hero: orbit, funnel, needs you */
.mi .ov-hero{display:flex;flex-wrap:wrap;gap:24px 34px;align-items:center;padding:22px 24px}
.mi .ov-orbit{position:relative;width:min(250px,100%);aspect-ratio:1;flex:none;margin:0 auto}
.mi .ov-orbit svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
.mi .ov-orbit circle{fill:none;stroke-width:12}
.mi .ov-orbit .seg-arc{filter:drop-shadow(0 0 5px color-mix(in srgb,var(--k) 70%,transparent));stroke:var(--k)}
.mi .ov-orbit .c{position:absolute;inset:0;display:grid;place-content:center;text-align:center}
.mi .ov-orbit .c b{font:400 76px/.9 var(--serif);color:var(--ink);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.mi .ov-fun{flex:1 1 380px;min-width:0;display:grid;gap:10px}
.mi .ov-fr{display:grid;grid-template-columns:minmax(92px,120px) minmax(0,1fr) 84px;gap:12px;align-items:center;width:100%;text-align:left;padding:4px 8px;margin:0 -8px;border-radius:12px}
.mi .ov-fr:hover{background:var(--hover)}
.mi .ov-fr[aria-pressed=true]{background:var(--sel);box-shadow:inset 0 0 0 1px var(--line2)}
.mi .ov-fr .l{font:600 10.5px var(--mono);letter-spacing:.13em;text-transform:uppercase;color:var(--k)}
.mi .ov-fr .t{height:22px;border-radius:7px;background:rgba(120,190,255,.05);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.mi .ov-fr .t i{display:block;height:100%;border-radius:7px;background:linear-gradient(90deg,color-mix(in srgb,var(--k) 35%,transparent),var(--k));box-shadow:0 0 14px -2px var(--k)}
.mi .ov-fr .n{font:500 22px/1 var(--sans);font-variant-numeric:tabular-nums;color:var(--ink);text-align:right}
.mi .ov-fr .n small{display:block;font:11px var(--mono);color:var(--dim);margin-top:3px}
@media(max-width:560px){.mi .ov-hero{padding:18px 16px}.mi .ov-fr{grid-template-columns:82px minmax(0,1fr) 52px;gap:8px}.mi .ov-fr .n{font-size:18px}.mi .ov-fun{flex-basis:100%}}
.mi .ov-side{display:flex;flex-wrap:wrap;gap:8px}
.mi .ov-sf{display:inline-flex;gap:10px;align-items:baseline;border-radius:12px;padding:7px 12px;box-shadow:inset 0 0 0 1px var(--line);background:var(--glass2)}
.mi .ov-sf:hover{box-shadow:inset 0 0 0 1px var(--line2)}
.mi .ov-sf[aria-pressed=true]{background:var(--sel);box-shadow:inset 0 0 0 1px var(--k)}
.mi .ov-sf b{font:500 20px/1 var(--sans);font-variant-numeric:tabular-nums;color:var(--ink)}
.mi .ov-sf span{font:600 10.5px var(--mono);letter-spacing:.13em;text-transform:uppercase;color:var(--k)}
.mi .ov-foot{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;font:11.5px var(--mono);color:var(--dim)}
.mi .ov-cap{flex:1 1 300px;max-width:400px;padding:16px;gap:12px;background:radial-gradient(120% 120% at 100% 0%,color-mix(in srgb,var(--now) 16%,transparent),transparent 60%),rgba(2,5,11,.6)}
@media(max-width:1180px){.mi .ov-cap{max-width:none}}
.mi .ov-act{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;align-items:center;padding-top:12px;border-top:1px dashed color-mix(in srgb,var(--now) 30%,transparent)}
.mi .ov-act .w{font-size:13.5px;color:var(--ink);text-align:left;min-width:0;overflow-wrap:anywhere}
.mi .ov-act .d{font:11.5px/1.5 var(--mono);color:var(--now)}
.mi .ov-act .a{grid-column:2;display:flex;justify-content:flex-start;margin-top:4px}
/* activity */
.mi .ov-chart text{font-family:var(--mono)}
.mi .ov-bar{fill:url(#ov-bar-grad);filter:drop-shadow(0 0 6px rgba(127,227,255,.45))}
.mi .ov-tip{background:#071225;border:1px solid var(--line2);border-radius:12px;padding:8px 12px;font:12px/1.55 var(--mono);color:var(--ink2);box-shadow:0 20px 50px -20px #000}
.mi .ov-tip b{color:var(--ink)}
/* response-time rulers */
.mi .ov-rul{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;padding:10px 0;border-top:1px dashed var(--line)}
.mi .ov-rul:first-child{border-top:0}
.mi .ov-rul .track{grid-column:1/3;position:relative;height:14px}
.mi .ov-rul .track::before{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:rgba(120,190,255,.1);border-radius:2px}
.mi .ov-rul .rng{position:absolute;top:4px;height:6px;border-radius:6px;background:color-mix(in srgb,var(--k) 40%,transparent)}
.mi .ov-rul .med{position:absolute;top:1px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--k);box-shadow:0 0 0 3px #02050b,0 0 12px var(--k)}
.mi .ov-scale{display:flex;justify-content:space-between;font:10.5px var(--mono);color:var(--dim);margin-top:4px}
/* assessments as rounds */
.mi .ov-rnds{position:relative;display:grid;gap:12px;list-style:none;margin:0;padding:0}
.mi .ov-rnds::before{content:"";position:absolute;left:17px;top:18px;bottom:18px;width:1px;background:var(--line2)}
.mi .ov-rd{position:relative;display:grid;grid-template-columns:36px minmax(0,1fr);gap:12px;align-items:start}
.mi .ov-rd .nd{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#02050b;color:var(--k);box-shadow:inset 0 0 0 1.5px var(--k),0 0 16px -4px var(--k)}
.mi .ov-rd .bx{padding:12px 14px;border-radius:14px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line);min-width:0}
.mi .ov-meta{font:11.5px/1.6 var(--mono);color:var(--ink2);display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:6px}
/* rejection reasons */
.mi .ov-quote{font:italic 400 24px/1.25 var(--serif);color:var(--ink);text-wrap:balance;margin:0}
.mi .ov-nobig{display:flex;align-items:baseline;gap:10px;padding-top:14px;border-top:1px dashed var(--line);color:var(--ink2)}
.mi .ov-nobig b{font:400 40px/1 var(--serif);color:var(--ink)}
/* comparisons as heat cells */
.mi .ov-heat{border-collapse:separate;border-spacing:4px;margin:0 -4px;min-width:100%;font-size:13px}
.mi .ov-heat th{font:600 10px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim);text-align:left;padding:2px 8px}
.mi .ov-heat td{padding:7px 10px;border-radius:8px;color:var(--ink2);white-space:nowrap}
.mi .ov-heat td.c{font:12px var(--mono);color:var(--ink);background:color-mix(in srgb,var(--k) var(--p),rgba(120,190,255,.03))}
.mi .ov-heat tr.flag td:first-child{box-shadow:inset 2px 0 0 var(--em)}
.mi .ov-heat tr.thin td{opacity:.55}
/* AI report as lessons */
.mi .ov-lesson{font:italic 400 21px/1.34 var(--serif);color:var(--ink);padding-left:18px;border-left:1px solid var(--line2);margin-top:10px}
.mi .ov-lesson small{display:block;font:11.5px/1.5 var(--mono);font-style:normal;color:var(--dim);margin-top:8px}
/* grids */
.mi .ov-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:18px;align-items:start}
.mi .ov-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:18px;align-items:start}
/* applications table */
.mi .ov-apps{overflow:hidden}
.mi .ov-apps-h{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px 14px;padding:18px 20px 12px}
.mi .ov-apps-h h2{margin:0;font:400 32px/1 var(--serif);color:var(--ink);letter-spacing:-.01em}
.mi .ov-apps-h h2 small{font:11.5px var(--mono);color:var(--dim);margin-left:10px;letter-spacing:0}
.mi .ov-scroll{overflow-x:auto}
.mi .ov-table{min-width:100%;border-collapse:collapse}
.mi .ov-table th{padding:10px 14px;font:600 10.5px var(--mono);letter-spacing:.13em;text-transform:uppercase;color:var(--dim);text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
.mi .ov-table td{padding:11px 14px;vertical-align:top;font-size:13px;color:var(--ink2);border-top:1px solid var(--line)}
.mi .ov-table tbody tr{cursor:pointer}
.mi .ov-table tbody tr:hover{background:var(--hover)}
.mi .ov-who{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 12px;align-items:center;text-align:left;min-width:220px;max-width:360px}
.mi .ov-who .logo{grid-row:span 2}
.mi .ov-who b{font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.mi .ov-who span{font-size:12px;color:var(--dim);overflow-wrap:anywhere}
.mi .ov-mlist{list-style:none;margin:0;padding:0}
.mi .ov-mlist>li{border-top:1px solid var(--line)}
.mi .ov-mlist>li>button{display:grid;gap:8px;width:100%;padding:12px 16px;text-align:left}
.mi .ov-more{display:flex;width:100%;justify-content:center;gap:6px;padding:12px;border-top:1px solid var(--line);font:500 12.5px var(--sans);color:var(--em)}
.mi .ov-more:hover{background:var(--hover)}
.mi .ov-howto{padding:4px 4px 0;color:var(--ink2)}
.mi .ov-howto summary{display:inline-flex;align-items:center;gap:6px;cursor:pointer;list-style:none;font:600 10.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.mi .ov-howto summary::-webkit-details-marker{display:none}
.mi .ov-howto summary:hover{color:var(--ink)}
.mi .ov-howto p{font-size:13px;line-height:1.65;color:var(--ink2);max-width:820px}
`;
