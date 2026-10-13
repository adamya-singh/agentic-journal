// Bugs/Features carries the Horizon Dawn look from the home page: a dawn-sky band with a rising
// sun, serif italic headings, the prompt in a night-sky terminal, and a sun-colored primary action.
// Plain CSS in a string (like BRIEF_CSS) because gradients and glows are clumsy as utilities.
// The drawer sits above the Cedar chat button and settings popover (z-index 9999).
export const BF_CSS = `
.bf-root{
  --bf-paper:#fbf8f4;--bf-card:#fff;--bf-rule:#ece5dc;--bf-rule-2:#e2d8cc;
  --bf-ink:#1b2233;--bf-ink-2:#4a5263;--bf-ink-3:#8a8f9a;
  --bf-night:#0b1730;--bf-term:#0b1730;--bf-term-ink:#e6ecf4;--bf-term-dim:#7f93b5;
  --bf-sun-1:#fff6d8;--bf-sun-2:#ffd27a;--bf-sun-3:#ff9a3c;--bf-sun-ink:#5a2a08;
  --bf-bug:#e11d48;--bf-feat:#0d9488;--bf-glow:rgba(255,154,60,.28);
  --bf-shadow:0 30px 60px -20px rgba(27,34,51,.35),0 0 0 1px rgba(27,34,51,.05);
  --bf-card-shadow:0 1px 2px rgba(27,34,51,.06),0 8px 20px -12px rgba(27,34,51,.25);
  --bf-sans:var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;
  --bf-mono:var(--font-geist-mono),ui-monospace,Menlo,monospace;
  --bf-serif:var(--font-instrument-serif),"Instrument Serif",Georgia,serif;
  color:var(--bf-ink);font-family:var(--bf-sans)
}
.dark .bf-root{
  --bf-paper:#0d1322;--bf-card:#141c2f;--bf-rule:#1f2a40;--bf-rule-2:#2a3752;
  --bf-ink:#eef2f8;--bf-ink-2:#b7c1d3;--bf-ink-3:#7684a0;
  --bf-term:#060a14;--bf-term-dim:#6f82a6;
  --bf-bug:#fb7185;--bf-feat:#2dd4bf;--bf-glow:rgba(255,154,60,.22);
  --bf-shadow:0 30px 60px -20px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.04);
  --bf-card-shadow:0 1px 2px rgba(0,0,0,.3),0 10px 24px -14px rgba(0,0,0,.8)
}
.bf-root *{box-sizing:border-box}
:where(.bf-root) button{font:inherit;color:inherit;cursor:pointer}
.bf-root :focus-visible{outline:2px solid var(--bf-sun-3);outline-offset:2px}

/* header button */
.bf-hbtn{position:relative;flex:none;display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 6px 0 9px;border-radius:999px;border:1px solid #e5e7eb;background:transparent;color:#374151;font-size:13px;font-weight:500;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.dark .bf-hbtn{border-color:#374151;color:#d1d5db}
.bf-hbtn:hover,.bf-hbtn[aria-expanded="true"]{border-color:#ff9a3c;box-shadow:0 0 0 4px rgba(255,154,60,.22)}
.bf-hbtn svg{width:18px;height:18px;flex:none}
.bf-hbtn .bf-n{min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:linear-gradient(180deg,#ffd27a,#ff9a3c);color:#5a2a08;font-size:11px;font-weight:700;display:inline-grid;place-items:center;font-variant-numeric:tabular-nums}
.bf-hbtn .bf-n.zero{background:#e5e7eb;color:#6b7280}
.dark .bf-hbtn .bf-n.zero{background:#374151;color:#9ca3af}
@media (max-width:640px){.bf-hbtn .bf-lbl{display:none}}

/* sky band */
.bf-sky{position:relative;flex:none;overflow:hidden;color:#fff6ec;
  background:
    radial-gradient(1px 1px at 12% 22%,rgba(255,255,255,.9),transparent 60%),
    radial-gradient(1px 1px at 31% 12%,rgba(255,255,255,.7),transparent 60%),
    radial-gradient(1.5px 1.5px at 47% 30%,rgba(255,255,255,.8),transparent 60%),
    radial-gradient(1px 1px at 66% 16%,rgba(255,255,255,.6),transparent 60%),
    radial-gradient(1px 1px at 88% 26%,rgba(255,255,255,.7),transparent 60%),
    linear-gradient(180deg,#0b1730 0%,#1b3f6e 46%,#5b7aa6 74%,#c9a08a 91%,#e39a5f 100%)}
.bf-sun{position:absolute;right:54px;bottom:-64px;width:128px;height:128px;border-radius:50%;pointer-events:none;
  background:radial-gradient(circle at 50% 45%,#fff6d8 0 30%,#ffd27a 52%,#ff9a3c 78%,#ff7a2f 100%);
  box-shadow:0 0 40px 14px rgba(255,194,107,.55),0 0 120px 40px rgba(255,154,60,.3)}
@media (prefers-reduced-motion:no-preference){
  .bf-sun{animation:bf-rise 1.1s .05s cubic-bezier(.2,.7,.1,1) both}
  @keyframes bf-rise{from{transform:translateY(46px);filter:saturate(.6) brightness(.85)}}
}
.bf-eyebrow{font:500 10.5px var(--bf-mono);letter-spacing:.16em;text-transform:uppercase;color:rgba(230,236,244,.72)}
.bf-title{margin:2px 0 0;font:400 38px/1 var(--bf-serif);letter-spacing:-.01em}
.bf-title em{font-style:italic;color:#ffd27a}
.bf-tally{text-align:right;font:11px/1.6 var(--bf-mono);color:rgba(230,236,244,.8);font-variant-numeric:tabular-nums;padding-top:4px}
.bf-tally b{color:#fff;font-weight:500}
.bf-x{width:32px;height:32px;border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;display:grid;place-items:center;flex:none}
.bf-x:hover{background:rgba(255,255,255,.22)}
.bf-seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:rgba(11,23,48,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.14)}
.bf-seg button{border:0;background:none;padding:5px 14px;border-radius:999px;font-size:13px;font-weight:500;color:rgba(255,246,236,.82)}
.bf-seg button[aria-selected="true"],.bf-seg button[aria-pressed="true"]{background:#fff6ec;color:#0b1730;box-shadow:0 2px 10px rgba(0,0,0,.18)}
.bf-seg .bf-c{font-variant-numeric:tabular-nums;opacity:.6;margin-left:4px}

/* drawer */
.bf-scrim{position:fixed;inset:0;z-index:10010;background:rgba(17,24,39,.28);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.dark .bf-scrim{background:rgba(0,0,0,.5)}
.bf-drawer{position:fixed;top:10px;right:10px;bottom:10px;width:min(520px,calc(100% - 20px));z-index:10011;background:var(--bf-paper);border-radius:18px;overflow:hidden;box-shadow:var(--bf-shadow);display:flex;flex-direction:column}
.bf-drawer .bf-sky{padding:calc(16px + env(safe-area-inset-top,0px)) 18px 14px 22px}
.bf-skytop{position:relative;display:flex;align-items:flex-start;gap:10px}
.bf-skytop .bf-tally{margin-left:auto}
.bf-drawer .bf-seg{position:relative;margin-top:16px}
.bf-body{flex:1;overflow-y:auto;padding:18px 22px 22px;display:grid;gap:22px;align-content:start}
.bf-foot{flex:none;border-top:1px solid var(--bf-rule);padding:12px 18px calc(12px + env(safe-area-inset-bottom,0px)) 22px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bf-status{margin-right:auto;font:11px var(--bf-mono);color:var(--bf-ink-3);display:inline-flex;align-items:center;gap:6px}
.bf-status::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--bf-feat)}
.bf-status.err{color:var(--bf-bug)} .bf-status.err::before{background:var(--bf-bug)}
.bf-status .bf-link{margin-left:4px}
@media (max-width:640px){
  .bf-drawer{top:0;right:0;bottom:0;width:100%;border-radius:0}
  .bf-title{font-size:32px}
  .bf-sun{right:24px;width:104px;height:104px;bottom:-54px}
  .bf-body{padding-inline:16px}
  .bf-foot{padding-left:16px}
  .bf-status{flex-basis:100%}
  .bf-k{display:none}
}

/* form */
.bf-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.bf-kinds{display:inline-flex;gap:6px}
.bf-kinds button{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px 0 10px;border-radius:999px;border:1px solid var(--bf-rule-2);background:var(--bf-card);font-size:13px;font-weight:500;color:var(--bf-ink-2);transition:border-color .15s,box-shadow .15s}
.bf-kinds i{width:8px;height:8px;border-radius:50%;background:var(--k)}
.bf-kinds button[aria-pressed="true"]{border-color:var(--k);color:var(--bf-ink);box-shadow:0 0 0 3px color-mix(in srgb,var(--k) 16%,transparent)}
.bf-kinds button[aria-pressed="true"] i{box-shadow:0 0 8px var(--k)}
.bf-root [data-kind="bug"]{--k:var(--bf-bug)} .bf-root [data-kind="feature"]{--k:var(--bf-feat)}
.bf-ctx{display:inline-flex;align-items:center;gap:6px;height:30px;max-width:100%;font:11.5px var(--bf-mono);color:var(--bf-ink-3);padding:0 4px 0 10px;border-radius:999px;border:1px dashed var(--bf-rule-2);min-width:0}
.bf-ctx b{color:var(--bf-ink-2);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.bf-ctx button{border:0;background:none;color:var(--bf-ink-3);width:22px;height:22px;border-radius:50%;font-size:14px;line-height:1;flex:none}
.bf-ctx button:hover{background:var(--bf-rule)}
.bf-link{border:0;background:none;padding:0;font:inherit;color:var(--bf-ink-2);text-decoration:underline;text-underline-offset:2px}
.bf-field{display:grid;gap:9px}
.bf-label{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.bf-h{font:italic 400 23px/1 var(--bf-serif);color:var(--bf-ink)}
.bf-label small{font:11px var(--bf-mono);color:var(--bf-ink-3);letter-spacing:.02em}
.bf-label .r{margin-left:auto}
.bf-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.bf-shot{position:relative;aspect-ratio:16/10;max-width:100%;border-radius:12px;overflow:hidden;background:var(--bf-card);box-shadow:var(--bf-card-shadow);transition:transform .18s}
.bf-shot:hover{transform:translateY(-2px)}
.bf-shot img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block;cursor:zoom-in}
.bf-shot::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px rgba(27,34,51,.08);pointer-events:none}
.bf-shot .rm{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;border:0;background:rgba(11,23,48,.72);color:#fff;font-size:14px;line-height:1;display:grid;place-items:center;opacity:0;transition:opacity .15s}
.bf-shot:hover .rm,.bf-shot .rm:focus-visible{opacity:1}
@media (hover:none){.bf-shot .rm{opacity:1}}
.bf-shot .num{position:absolute;left:7px;bottom:7px;font:500 10px var(--bf-mono);background:rgba(11,23,48,.72);color:#fff6ec;padding:2px 6px;border-radius:999px}
.bf-add{aspect-ratio:16/10;max-width:100%;border-radius:12px;border:1.5px dashed var(--bf-rule-2);background:transparent;display:grid;place-items:center;align-content:center;gap:6px;color:var(--bf-ink-3);font-size:12px;padding:8px;text-align:center;transition:border-color .15s,background .15s,color .15s}
.bf-add svg{width:44px;height:24px}
.bf-add b{font:500 12px var(--bf-mono);color:var(--bf-ink-2)}
.bf-add:hover,.bf-drop.hot .bf-add{border-color:var(--bf-sun-3);color:var(--bf-ink-2);background:var(--bf-glow)}
.bf-shots.empty{grid-template-columns:1fr}
.bf-shots.empty .bf-add{aspect-ratio:auto;padding:26px 10px}
.bf-shots.empty .bf-add svg{width:72px;height:38px}
.bf-root textarea{width:100%;resize:vertical;border:1px solid var(--bf-rule-2);border-radius:12px;padding:12px 14px;background:var(--bf-card);font:14.5px/1.55 var(--bf-sans);color:var(--bf-ink);box-shadow:0 1px 2px rgba(27,34,51,.04)}
.bf-root textarea::placeholder{color:var(--bf-ink-3)}
.bf-root textarea:focus{outline:none;border-color:var(--bf-sun-3);box-shadow:0 0 0 4px var(--bf-glow)}
.bf-term{position:relative;border-radius:14px;background:var(--bf-term);box-shadow:var(--bf-card-shadow),inset 0 0 0 1px rgba(255,255,255,.05);overflow:hidden}
.bf-term::before{content:"";position:absolute;left:0;right:0;bottom:0;height:60px;background:radial-gradient(60% 100% at 85% 120%,rgba(255,154,60,.18),transparent 70%);pointer-events:none}
.bf-termbar{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid rgba(255,255,255,.07);font:11px var(--bf-mono);color:var(--bf-term-dim)}
.bf-termbar .who{color:var(--bf-sun-2)}
.bf-termbar .r{margin-left:auto}
.bf-root .bf-term textarea{position:relative;border:0;border-radius:0;background:transparent;box-shadow:none;color:var(--bf-term-ink);font:12.5px/1.65 var(--bf-mono);padding:12px 14px 14px;caret-color:var(--bf-sun-2)}
.bf-root .bf-term textarea::placeholder{color:var(--bf-term-dim)}
.bf-root .bf-term textarea:focus{box-shadow:none}
.bf-term:focus-within{box-shadow:0 0 0 4px var(--bf-glow),var(--bf-card-shadow)}
.bf-pv summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:10px}
.bf-pv summary::-webkit-details-marker{display:none}
.bf-pv summary .bf-h{font-size:19px;color:var(--bf-ink-2)}
.bf-pv summary small{font:11px var(--bf-mono);color:var(--bf-ink-3)}
.bf-pre{margin:10px 0 0;font:11.5px/1.6 var(--bf-mono);white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bf-term);color:var(--bf-term-ink);border-radius:12px;padding:12px 14px;max-height:300px;overflow-y:auto}

/* buttons */
.bf-btn{height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--bf-rule-2);background:var(--bf-card);font-size:13px;font-weight:500;color:var(--bf-ink-2);display:inline-flex;align-items:center;gap:7px;transition:border-color .15s,transform .1s;white-space:nowrap}
.bf-btn:hover{border-color:var(--bf-ink-3)}
.bf-btn:active{transform:translateY(1px)}
.bf-btn:disabled{opacity:.55;cursor:default}
.bf-btn.rise{border:0;background:linear-gradient(180deg,#ffd27a,#ff9a3c);color:#5a2a08;font-weight:600;box-shadow:0 6px 16px -6px rgba(255,122,47,.7),inset 0 1px 0 rgba(255,255,255,.5)}
.bf-btn.rise:hover{filter:brightness(1.04)}
.bf-btn .bf-k{font:500 10.5px var(--bf-mono);opacity:.65}
.bf-btn.small{height:28px;padding:0 11px;font-size:12px}
.bf-btn.ghost{border-color:transparent;background:transparent;color:var(--bf-ink-3)}
.bf-btn.ghost:hover{color:var(--bf-ink);background:var(--bf-rule)}
.bf-btn.danger:hover{color:var(--bf-bug)}

/* filters + cards */
.bf-filters{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--bf-rule);justify-self:start}
.bf-filters button{border:0;background:none;padding:4px 13px;border-radius:999px;font-size:12.5px;font-weight:500;color:var(--bf-ink-3)}
.bf-filters button[aria-pressed="true"]{background:var(--bf-card);color:var(--bf-ink);box-shadow:0 1px 3px rgba(27,34,51,.12)}
.bf-cards{display:grid;gap:14px;align-items:start}
.bf-card{border-radius:16px;background:var(--bf-card);box-shadow:var(--bf-card-shadow);overflow:hidden;display:grid;min-width:0;transition:transform .18s}
.bf-card:hover{transform:translateY(-1px)}
.bf-card.fresh{animation:bf-fresh 1.6s ease-out}
@keyframes bf-fresh{0%{box-shadow:0 0 0 3px #ff9a3c,0 0 36px 6px var(--bf-glow)}100%{box-shadow:var(--bf-card-shadow)}}
.bf-banner{position:relative;height:120px;overflow:hidden;background:var(--bf-rule);border:0;padding:0;display:block;width:100%;cursor:zoom-in}
.bf-banner img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
.bf-banner .more{position:absolute;right:10px;bottom:10px;font:500 10.5px var(--bf-mono);background:rgba(11,23,48,.75);color:#fff6ec;padding:3px 8px;border-radius:999px}
.bf-cardin{padding:14px 16px 12px;display:grid;gap:8px;min-width:0}
.bf-cardtop{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font:11px var(--bf-mono);color:var(--bf-ink-3)}
.bf-kd{display:inline-flex;align-items:center;gap:6px;color:var(--k);font-weight:500;text-transform:uppercase;letter-spacing:.08em;font-size:10.5px}
.bf-kd i{width:7px;height:7px;border-radius:50%;background:var(--k)}
.bf-card h3{margin:0;font-size:15px;font-weight:600;line-height:1.4;text-wrap:pretty;color:var(--bf-ink);overflow-wrap:anywhere}
.bf-card .bf-desc{margin:0;font-size:13px;color:var(--bf-ink-2);white-space:pre-wrap;overflow-wrap:anywhere}
.bf-pr{font:11.5px/1.55 var(--bf-mono);color:var(--bf-term-ink);background:var(--bf-term);border-radius:10px;padding:8px 11px}
.bf-pr span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.bf-pr span::before{content:"› ";color:var(--bf-sun-2)}
.bf-nopr{margin:0;font-size:12px;color:var(--bf-ink-3);font-style:italic}
.bf-acts{display:flex;gap:4px;flex-wrap:wrap;align-items:center;padding-top:2px}
.bf-acts .gap{margin-left:auto}
.bf-confirm{font-size:12px;color:var(--bf-ink-2);margin-right:4px}
.bf-card .bf-pre{margin:0 16px 14px}
.bf-card.shipped{box-shadow:none;border:1px solid var(--bf-rule);background:transparent}
.bf-card.shipped h3{color:var(--bf-ink-3);text-decoration:line-through;text-decoration-color:var(--bf-rule-2)}
.bf-card.shipped .bf-banner{height:56px;filter:grayscale(1) opacity(.5)}
.bf-empty{text-align:center;color:var(--bf-ink-3);padding:34px 10px;display:grid;justify-items:center;gap:10px;font-size:13px}
.bf-empty svg{width:72px;height:38px}
.bf-empty .bf-h{font-size:24px;color:var(--bf-ink-2)}

/* page */
.bf-page{min-height:calc(100vh - 57px);background:var(--bf-paper)}
.bf-page-in{max-width:1180px;margin:0 auto;padding:16px 16px 48px;display:grid;gap:18px}
.bf-hero{border-radius:18px;padding:20px 22px 18px;box-shadow:var(--bf-card-shadow)}
.bf-hero-in{position:relative;display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px 20px}
.bf-hero .bf-title{font-size:44px}
.bf-hero .bf-sun{right:64px;bottom:-74px;width:150px;height:150px}
.bf-hero .bf-tally{text-align:left}
.bf-hero-new{margin-left:auto;align-self:flex-start}
.bf-hero-acts{flex-basis:100%;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.bf-page .bf-cards{grid-template-columns:repeat(auto-fill,minmax(min(380px,100%),1fr))}
@media (max-width:640px){.bf-hero .bf-title{font-size:36px}.bf-hero .bf-sun{right:20px}}

.bf-toast{position:fixed;left:50%;bottom:calc(26px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:10015;background:#0b1730;color:#fff6ec;padding:9px 16px 9px 12px;border-radius:999px;font-size:13px;box-shadow:0 20px 40px -12px rgba(0,0,0,.5);max-width:calc(100% - 32px);display:flex;align-items:center;gap:8px}
.bf-toast::before{content:"";width:10px;height:10px;border-radius:50%;background:radial-gradient(circle,#fff6d8,#ff9a3c);box-shadow:0 0 10px #ffc26b;flex:none}
.bf-lightbox{position:fixed;inset:0;z-index:10020;background:rgba(6,10,20,.86);display:grid;place-items:center;padding:24px 16px;cursor:zoom-out;border:0}
.bf-lightbox img{max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 30px 80px rgba(0,0,0,.6)}
`;
