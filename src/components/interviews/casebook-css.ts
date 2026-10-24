// The Interviews casebook in the Mission theme (mockup E): an Earthrise HUD panel
// inside the normal Jobs page. Every rule is scoped under .cb. Colors carry meaning:
// hue = kind of round, ring arcs = rounds in order, amber = needs you now.
export const CASEBOOK_CSS = `
.cb{--bg:#02050b;--ink:#e6f1ff;--ink2:#b7c6dc;--dim:#7d8ea8;--faint:#4a5872;--line:rgba(120,190,255,.12);--line2:rgba(120,190,255,.24);
--glass:linear-gradient(180deg,rgba(9,20,38,.78),rgba(4,10,22,.88));--glass2:rgba(120,190,255,.04);--hover:rgba(120,190,255,.07);
--em:#7fe3ff;--now:#ffb547;--sel:rgba(127,227,255,.08);--ghost:#7d8ea8;
--c-screen:#b59cff;--c-oa:#ffb547;--c-tech:#59f0c9;--c-ml:#6ec6ff;--c-behav:#ff8ac6;--c-fit:#c9f26b;--c-onsite:#ff9d6b;--c-other:#9fb3d1;--c-offer:#7dffb2;--c-reject:#ff6b6b;--c-applied:#7d8ea8;
--serif:var(--font-instrument-serif),'Instrument Serif',Georgia,serif;--mono:var(--font-geist-mono),'Geist Mono',ui-monospace,monospace;--sans:var(--font-geist-sans),Geist,ui-sans-serif,system-ui,sans-serif;
position:relative;isolation:isolate;color:var(--ink);font:14px/1.5 var(--sans);border-radius:20px;overflow:hidden;color-scheme:dark;
background:radial-gradient(160% 70% at 50% -42%,rgba(57,184,255,.30) 0,rgba(57,184,255,.07) 38%,transparent 39.2%),radial-gradient(160% 70% at 50% -40%,transparent 38.6%,rgba(127,227,255,.5) 39%,transparent 39.6%),linear-gradient(rgba(120,190,255,.035) 1px,transparent 1px) 0 0/100% 32px,linear-gradient(90deg,rgba(120,190,255,.035) 1px,transparent 1px) 0 0/32px 100%,#02050b;
box-shadow:0 30px 80px -30px rgba(0,0,0,.6),0 0 0 1px rgba(120,190,255,.1)}
.cb *{box-sizing:border-box}
.cb button,.cb input,.cb textarea,.cb select{font:inherit;color:inherit}
.cb button{cursor:pointer;background:none;border:0;padding:0}
.cb :focus-visible{outline:2px solid var(--em);outline-offset:2px;border-radius:6px}
.cb svg.i{width:16px;height:16px;flex:none;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.cb svg.i.s{width:13px;height:13px}
.cb .tn{font-variant-numeric:tabular-nums}
.cb .mono{font-family:var(--mono)}
.cb .lab{font:600 10.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.cb .glass{background:var(--glass);border:1px solid var(--line);border-radius:18px;backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.cb-top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px 16px;padding:14px 22px;border-bottom:1px solid var(--line)}
.cb-title{font:400 30px/1 var(--serif);letter-spacing:-.01em}
.cb-title i{color:var(--em)}
.cb-views{display:flex;gap:2px;overflow-x:auto;max-width:100%;scrollbar-width:none}
.cb .cb-vbtn{padding:6px 12px;border-radius:999px;color:var(--dim);font-weight:550;font-size:13px;display:inline-flex;gap:7px;align-items:center;white-space:nowrap}
.cb .cb-vbtn[aria-pressed=true]{color:var(--ink);background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line2)}
.cb .cb-vbtn .c{font:500 11px var(--mono);color:var(--faint)}
.cb-body{padding:20px 22px 34px}
@media(min-width:1100px){.cb-body{padding:22px 30px 40px}}
.cb .kind{display:inline-flex;align-items:center;gap:6px;font:600 10.5px var(--mono);letter-spacing:.13em;text-transform:uppercase;border-radius:6px;padding:3px 8px;white-space:nowrap;color:var(--k,var(--em));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--k,var(--em)) 55%,transparent)}
.cb .kind.solid{color:var(--bg);background:var(--k,var(--em));box-shadow:none}
.cb .btn{display:inline-flex;align-items:center;gap:7px;border-radius:12px;padding:8px 14px;font-weight:600;font-size:13px;white-space:nowrap;border:1px solid var(--line2);color:var(--ink);background:var(--glass2);transition:transform .12s,border-color .12s}
.cb .btn:hover{border-color:var(--em)}
.cb .btn:active{transform:scale(.97)}
.cb .btn:disabled{opacity:.45;cursor:not-allowed}
.cb .btn.pri{background:var(--em);color:#021018;border-color:transparent}
.cb .btn.sm{padding:5px 10px;font-size:12px;border-radius:10px}
.cb .out{display:inline-flex;gap:6px;align-items:center;font:600 11px var(--mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.cb .out i{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
.cb .o-open{color:var(--c-screen)}.cb .o-offer{color:var(--c-offer)}.cb .o-rejected{color:var(--c-reject)}.cb .o-no-reply,.cb .o-withdrawn{color:var(--ghost)}.cb .o-now{color:var(--now)}
.cb .seg{display:inline-flex;border-radius:999px;padding:3px;gap:2px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line)}
.cb .seg button{border-radius:999px;padding:5px 13px;font-weight:600;font-size:13px;color:var(--dim);display:inline-flex;gap:7px;align-items:baseline}
.cb .seg button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.cb .seg small{font:500 11px var(--mono);opacity:.7}
.cb .search{display:flex;align-items:center;gap:9px;border-radius:12px;padding:8px 12px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line);color:var(--dim)}
.cb .search input{border:0;outline:none;background:transparent;width:100%;color:var(--ink)}
.cb .search kbd{font:11px var(--mono);border:1px solid var(--line2);border-radius:5px;padding:0 6px;color:var(--faint)}
.cb .av{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;font:600 10.5px var(--mono);background:var(--glass2);color:var(--ink2);box-shadow:inset 0 0 0 1px var(--line2);flex:none}
.cb .avs{display:inline-flex}.cb .avs .av+.av{margin-left:-7px}
.cb .logo{display:inline-grid;place-items:center;flex:none;width:34px;height:34px;border-radius:10px;background:#fff;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 4px 14px -6px rgba(0,0,0,.6)}
.cb .logo img{width:78%;height:78%;object-fit:contain}
.cb .logo.letter{background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line2);font:italic 400 19px/1 var(--serif);color:var(--ink)}
.cb .logo.sm{width:24px;height:24px;border-radius:7px}.cb .logo.sm.letter{font-size:14px}
.cb .logo.xl{width:64px;height:64px;border-radius:18px}.cb .logo.xl.letter{font-size:34px}
.cb .md{font-size:14px;line-height:1.68;color:var(--ink2);overflow-wrap:anywhere}
.cb .md>*:first-child{margin-top:0}
.cb .md h1{font:400 32px/1.08 var(--serif);color:var(--ink);margin:2px 0 14px;text-wrap:balance}
.cb .md h2{font-size:15px;color:var(--ink);margin:24px 0 8px;font-weight:650}
.cb .md h3{font-size:14px;color:var(--ink);margin:18px 0 6px;font-weight:650}
.cb .md h4,.cb .md h5{font-size:13px;color:var(--ink);margin:14px 0 4px;font-weight:650}
.cb .md p{margin:8px 0}.cb .md ul,.cb .md ol{margin:6px 0;padding-left:20px}.cb .md ul{list-style:disc}.cb .md ol{list-style:decimal}.cb .md li{margin:3px 0}.cb .md li::marker{color:var(--faint)}
.cb .md blockquote{margin:12px 0;padding:8px 14px;border-left:2px solid var(--em);background:var(--sel);color:var(--ink);border-radius:0 10px 10px 0}
.cb .md pre{background:rgba(0,0,0,.4);border:1px solid var(--line);border-radius:12px;padding:12px 14px;overflow-x:auto;font-size:12.5px;line-height:1.55}
.cb .md code{font-family:var(--mono);font-size:12.5px}
.cb .md :not(pre)>code{background:rgba(0,0,0,.4);border:1px solid var(--line);padding:0 5px;border-radius:5px}
.cb .md strong{color:var(--ink)}.cb .md a{color:var(--em);text-decoration:underline}.cb .md hr{border:0;border-top:1px solid var(--line);margin:18px 0}
.cb .md table{border-collapse:collapse;display:block;overflow-x:auto}.cb .md td,.cb .md th{border:1px solid var(--line);padding:4px 8px}
.cb .empty{color:var(--dim);padding:20px;text-align:center}
.cb .err{color:var(--c-reject);font-size:12.5px}
/* doc chips */
.cb .docs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.cb .dc{display:grid;grid-template-columns:auto minmax(0,1fr);gap:1px 11px;align-items:center;text-align:left;width:100%;border-radius:13px;padding:9px 12px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line);transition:box-shadow .15s,background .15s,transform .15s}
.cb .dc:hover{box-shadow:inset 0 0 0 1px var(--line2);background:var(--hover);transform:translateY(-1px)}
.cb .dc[aria-pressed=true]{box-shadow:inset 0 0 0 1px var(--em);background:var(--sel)}
.cb .dc .ic{grid-row:span 2;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;color:var(--k,var(--ink2));background:color-mix(in srgb,var(--k,var(--ink2)) 14%,transparent)}
.cb .dc .t{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.cb .dc .m{font:11.5px var(--mono);color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* capture */
.cb .cap{position:relative;border-radius:20px;padding:18px;display:grid;gap:13px;background:radial-gradient(120% 90% at 100% 0%,color-mix(in srgb,var(--now) 18%,transparent),transparent 60%),var(--glass);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--now) 45%,transparent),0 20px 60px -30px color-mix(in srgb,var(--now) 70%,transparent)}
.cb .cap .hd{display:flex;flex-wrap:wrap;gap:10px 14px;justify-content:space-between;align-items:flex-start}
.cb .cap h3{margin:4px 0 0;font:400 30px/1.05 var(--serif);color:var(--ink)}
.cb .cap .sub{display:flex;gap:8px;align-items:center;color:var(--now);font:12px var(--mono);margin-top:6px}
.cb .pulse{width:8px;height:8px;border-radius:50%;background:var(--now);flex:none;animation:cbPulse 1.8s infinite}
@keyframes cbPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--now) 70%,transparent)}70%{box-shadow:0 0 0 9px transparent}100%{box-shadow:0 0 0 0 transparent}}
.cb .ed{border-radius:14px;background:rgba(0,0,0,.4);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.cb .ed:focus-within{box-shadow:inset 0 0 0 1px var(--em),0 0 0 4px var(--sel)}
.cb .ed .tb{display:flex;flex-wrap:wrap;gap:6px;padding:9px 10px;border-bottom:1px solid var(--line)}
.cb .ed .tb button{font:500 11.5px var(--mono);border-radius:999px;padding:4px 10px;color:var(--ink2);box-shadow:inset 0 0 0 1px var(--line2);display:inline-flex;gap:5px;align-items:center}
.cb .ed .tb button:hover{color:var(--em);box-shadow:inset 0 0 0 1px var(--em)}
.cb .ed textarea{display:block;width:100%;min-height:200px;border:0;outline:none;resize:vertical;padding:14px 16px;background:transparent;line-height:1.65;font-size:14.5px;color:var(--ink)}
.cb .ed textarea::placeholder{color:var(--faint)}
.cb .ed .ft{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:space-between;padding:8px 14px;border-top:1px solid var(--line);font:11.5px var(--mono);color:var(--dim)}
.cb .field{display:grid;gap:5px;font:11px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.cb .field input,.cb .field select{font:14px var(--sans);letter-spacing:0;text-transform:none;border-radius:10px;padding:8px 10px;background:rgba(0,0,0,.35);border:1px solid var(--line2);color:var(--ink);outline:none}
.cb .field input:focus,.cb .field select:focus{border-color:var(--em)}
/* talk strip */
.cb .talk{display:grid;gap:6px}
.cb .talk .hd{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font:11.5px var(--mono);color:var(--dim)}
.cb .talk .hd b{color:var(--ink);font-weight:600}
.cb .talk svg{width:100%;height:46px;display:block;border-radius:8px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line)}
.cb .talk rect{transform-box:fill-box;transform-origin:left center;animation:cbGrow .6s cubic-bezier(.16,1,.3,1) both}
@keyframes cbGrow{from{transform:scaleX(0)}to{transform:none}}
/* layout */
.cb-dos{display:grid;grid-template-columns:1fr;gap:22px}
@media(min-width:1000px){.cb-dos{grid-template-columns:290px minmax(0,1fr)}}
@media(min-width:1380px){.cb-dos{grid-template-columns:290px minmax(0,1fr) 420px}}
.cb-list{display:flex;flex-direction:column;gap:12px;min-width:0}
.cb .sum{display:flex;flex-wrap:wrap;gap:4px 12px;font:11.5px var(--mono);color:var(--dim)}
.cb .sum b{color:var(--ink);font-weight:600}
.cb .grp>h4{display:flex;justify-content:space-between;margin:12px 6px 6px}
.cb .pr{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 11px;align-items:center;width:100%;text-align:left;border-radius:14px;padding:9px 10px;transition:background .15s}
.cb .pr:hover{background:var(--hover)}
.cb .pr[aria-current=true]{background:var(--sel);box-shadow:inset 0 0 0 1px var(--line2)}
.cb .pr .logo{grid-row:span 2}
.cb .pr .c{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.cb .pr .r{grid-column:2/4;font-size:12.5px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb .pr .w{font:11px var(--mono);color:var(--faint);white-space:nowrap}
.cb .pr .w.now{color:var(--now)}
.cb .pr .w.warn{color:var(--c-oa)}
.cb .pips{display:inline-flex;gap:3px;margin-left:6px;vertical-align:1px}
.cb .pips i{width:7px;height:7px;border-radius:2px;background:var(--k);box-shadow:0 0 6px color-mix(in srgb,var(--k) 60%,transparent)}
.cb .more{display:flex;gap:9px;align-items:center;width:100%;border-radius:14px;padding:10px 12px;color:var(--dim);font-size:12.5px;text-align:left;box-shadow:inset 0 0 0 1px var(--line);background:repeating-linear-gradient(-45deg,transparent 0 6px,var(--glass2) 6px 12px)}
.cb .more:hover{color:var(--ink2)}
.cb-case{min-width:0;display:flex;flex-direction:column;gap:22px;animation:cbIn .45s cubic-bezier(.16,1,.3,1) both}
@keyframes cbIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.cb .hero{padding:20px 22px 18px;position:relative;overflow:hidden}
.cb .hero::before{content:"";position:absolute;inset:-60% -20% auto;height:120%;background:radial-gradient(closest-side,rgba(57,184,255,.16),transparent);pointer-events:none}
.cb .hero h2{margin:0;font:400 clamp(40px,7vw,62px)/.95 var(--serif);letter-spacing:-.02em;color:var(--ink);overflow-wrap:break-word}
.cb .hero .who{min-width:min(100%,240px);flex:1}
.cb .hero .role{font-size:16px;color:var(--ink2);margin-top:8px}
.cb .hero .facts{display:flex;flex-wrap:wrap;gap:4px 16px;font:12px var(--mono);color:var(--dim);margin-top:10px}
.cb .hero .facts a{color:var(--em)}
.cb .eb{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font:11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--em)}
.cb .tele{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:1px;margin-top:20px;background:var(--line);border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--line)}
.cb .tele div{background:var(--bg);padding:11px 14px}
.cb .tele b{display:block;font:500 22px/1.1 var(--sans);color:var(--ink);font-variant-numeric:tabular-nums}
.cb .tele span{font:10.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
.cb .flag{padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c-oa) 60%,transparent)}
.cb .flag>span{flex:1;min-width:220px;color:var(--ink2)}
.cb .sech{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:0 2px 12px}
.cb .sech h3{margin:0;font:400 28px/1.1 var(--serif);color:var(--ink)}
.cb .rounds{position:relative;display:grid;gap:14px}
.cb .rounds::before{content:"";position:absolute;left:19px;top:20px;bottom:20px;width:2px;background:linear-gradient(var(--line2),var(--line))}
.cb .rnd{position:relative;display:grid;grid-template-columns:40px minmax(0,1fr);gap:14px}
.cb .rnd .node{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:var(--k);background:var(--bg);box-shadow:inset 0 0 0 1.5px var(--k),0 0 22px -4px var(--k);z-index:1}
.cb .rnd.unscheduled .node,.cb .rnd.upcoming .node{box-shadow:inset 0 0 0 1.5px var(--line2);color:var(--ink2)}
.cb .rnd.cancelled .node{box-shadow:inset 0 0 0 1.5px var(--c-reject);color:var(--c-reject);opacity:.7}
.cb .rnd.capture .node{background:var(--now);color:var(--bg);box-shadow:0 0 0 6px color-mix(in srgb,var(--now) 18%,transparent),0 0 30px var(--now)}
.cb .rnd.unrecorded .node{box-shadow:inset 0 0 0 1.5px var(--c-oa);color:var(--c-oa)}
.cb .rbox{border-radius:18px;padding:15px 17px;display:grid;gap:12px;min-width:0;position:relative;overflow:hidden}
.cb .rbox::before{content:"";position:absolute;left:0;top:0;right:0;height:2px;background:linear-gradient(90deg,var(--k),transparent 70%);opacity:.7}
.cb .rtop{display:flex;flex-wrap:wrap;gap:8px 12px;justify-content:space-between;align-items:flex-start}
.cb .rtop .ti{font:400 26px/1.05 var(--serif);color:var(--ink)}
.cb .rtop .w{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font:11.5px var(--mono);color:var(--dim)}
.cb .rnote{font-size:13.5px;color:var(--dim)}
.cb .qs{display:grid;gap:7px}
.cb .qs .q{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;font-size:13.5px;color:var(--ink2);line-height:1.45}
.cb .qs .q i{width:7px;height:7px;border-radius:50%;background:var(--k);margin-top:7px;box-shadow:0 0 8px var(--k)}
.cb .qs .q small{display:block;color:var(--dim);font-size:12.5px}
.cb .side{min-width:0}
@media(min-width:1380px){.cb .side{position:sticky;top:12px;align-self:start}}
.cb .sbox{display:flex;flex-direction:column;overflow:hidden;border-radius:20px}
.cb .stabs{display:flex;gap:3px;padding:6px;border-bottom:1px solid var(--line)}
.cb .stabs button{flex:1;padding:7px 8px;border-radius:12px;font-weight:600;font-size:12.5px;color:var(--dim)}
.cb .stabs button[aria-pressed=true]{background:var(--glass2);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line2)}
.cb .sbody{padding:18px 20px;overflow:auto}
@media(min-width:1380px){.cb .sbody{max-height:calc(100vh - 110px)}}
.cb .rmeta{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font:11.5px var(--mono);color:var(--dim);padding-bottom:12px;margin-bottom:14px;border-bottom:1px solid var(--line)}
.cb .rmeta .p{flex-basis:100%;color:var(--faint);overflow-wrap:anywhere}
.cb .tl{list-style:none;margin:0;padding:0;display:grid}
.cb .tl li{display:grid;grid-template-columns:16px minmax(0,1fr);gap:11px;position:relative;padding-bottom:15px}
.cb .tl li::before{content:"";position:absolute;left:7px;top:16px;bottom:0;width:2px;background:var(--line)}
.cb .tl li:last-child::before{display:none}
.cb .tl .d{width:16px;height:16px;border-radius:50%;margin-top:2px;box-shadow:inset 0 0 0 2px var(--k);background:var(--bg)}
.cb .tl .d.f{background:var(--k);box-shadow:0 0 10px var(--k)}
.cb .tl .l{font-size:13.5px;color:var(--ink)}
.cb .tl .w{font:11.5px var(--mono);color:var(--dim)}
.cb .tl .s{font-size:12.5px;color:var(--dim);margin-top:2px}
.cb .ppl{display:grid;gap:12px}
.cb .pc{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 12px;align-items:center}
.cb .pc .av{grid-row:span 3;width:44px;height:44px;font-size:13px}
.cb .pc .nm{font-weight:650;color:var(--ink)}
.cb .pc .rl{font-size:12.5px;color:var(--dim)}
.cb .pc .co{display:flex;gap:7px;align-items:center;font:11.5px var(--mono);color:var(--ink2)}
.cb .pp{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
.cb .pp .pc{border-radius:18px;padding:14px 16px}
.cb .lesson{font:400 24px/1.25 var(--serif);color:var(--ink);padding:4px 0 4px 18px;border-left:2px solid var(--em);text-wrap:pretty}
.cb .lesson small{display:block;font:11.5px var(--mono);color:var(--dim);margin-top:6px}
/* question bank */
.cb .qb{display:grid;grid-template-columns:1fr;gap:22px}
@media(min-width:1000px){.cb .qb{grid-template-columns:250px minmax(0,1fr)}}
.cb .qf{display:flex;flex-direction:column;gap:3px}
.cb .qf button{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;color:var(--ink2);font-weight:550;font-size:13.5px;text-align:left}
.cb .qf button i{width:9px;height:9px;border-radius:50%;background:var(--k,var(--ink2));box-shadow:0 0 10px var(--k,transparent)}
.cb .qf button span{margin-left:auto;font:11.5px var(--mono);color:var(--faint)}
.cb .qf button[aria-pressed=true]{background:var(--sel);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line2)}
.cb .qgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.cb .qc{position:relative;border-radius:18px;padding:16px 18px 16px 20px;display:grid;gap:10px;overflow:hidden;align-content:start}
.cb .qc::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:var(--k);box-shadow:0 0 14px var(--k)}
.cb .qc .qt{font:400 21px/1.2 var(--serif);color:var(--ink);text-wrap:pretty}
.cb .qc .src{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font:11.5px var(--mono);color:var(--dim)}
.cb .qc .ans{font-size:13.5px;color:var(--ink2);line-height:1.55}
.cb .qc .ans b{display:block;font:600 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--k);margin-bottom:3px}
@media (prefers-reduced-motion: reduce){.cb *{animation:none!important;transition:none!important}}
`;
