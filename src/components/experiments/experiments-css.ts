// The Experiments page's own looks: the workspace an experiment opens into (cream, as a card to decide is on
// Sunrise) and the history under the horizon (the ground going down into the dark, one line per direction).
export const HUES = ['#f2b441', '#4cc3d9', '#ee6f8c', '#9d8cf7', '#57c78a', '#6aa6f8', '#f5804f', '#d58be8', '#b7c94a', '#a3aec6'] as const;
export const STATUS_COLOURS = { worked: '#3f9f6c', failed: '#d5484f', mixed: '#c98a12', finding: '#3f7fd6', running: '#7b8499', planned: '#9b8fc4' } as const;

export const EXPERIMENTS_CSS = `
/* A 3D picture is always on a dark stage, as a frame of video is. */
.art.look-scene,.xp-stage,.xh-pic{position:relative;overflow:hidden;background:radial-gradient(120% 100% at 50% 35%,#161c2c,#06080d 75%)}
.art.look-scene canvas,.xp-stage canvas,.xh-pic canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.shape.full .p-media .art.look-scene{height:150px}
/* A tile's words stay inside it: the picture takes its share first. */
.s-tile.sm .cap{overflow:hidden}
.s-tile.sm .cap>*{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.xs-add{display:inline-flex;align-items:center;gap:7px;float:right;font:500 13px var(--sans);color:#f3efe7;background:rgba(10,14,24,.55);border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:7px 14px;cursor:pointer;backdrop-filter:blur(6px)}
.xs-add:hover,.xs-add:focus-visible{border-color:#ffd2a8;outline:none}
.xs-err{position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:31;font:12.5px var(--sans);color:#ffd9d2;background:rgba(60,14,10,.9);border:1px solid rgba(255,140,120,.5);border-radius:999px;padding:6px 14px}

/* The journal's brief, chat and done components were drawn for Dawn's night sky; they read these (as on home). */
.sr-hero{--hz-ink:#f3efe7;--hz-dim:#a9b4c4;--hz-em:#ffd2a8;--hz-serif:var(--font-instrument-serif),'Instrument Serif',serif;--hz-sans:var(--font-geist-sans),Geist,sans-serif;--hz-mono:var(--font-geist-mono),'Geist Mono',monospace}
.xp{color:#22130a;font:14px/1.5 var(--sans);--a:#c2551b;min-width:0}
.xp-in{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;padding:0 0 18px}
.xp-stage{aspect-ratio:16/8;border-radius:12px;touch-action:pan-y;cursor:grab}
.xp-stage.wide{aspect-ratio:2.5/1;min-width:640px;cursor:default}
.xp-wide{overflow-x:auto;border-radius:12px}
.xp-cap{margin:6px 0 0;font-size:12.5px;color:#7a6656}
.xp-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font:500 11.5px var(--mono);color:#7a6656}
.xp-top b{color:#22130a;font-weight:600}
.xp-dir{display:inline-flex;align-items:center;gap:6px;color:#22130a}
.xp-dir i{width:8px;height:8px;border-radius:50%;background:var(--a)}
.xp-st{font:600 10.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--s);border:1px solid var(--s);border-radius:5px;padding:1px 7px}
.xp-fl{font:600 10.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;background:#c2410c;color:#fff;border-radius:5px;padding:2px 7px}
.xp-x{margin-left:auto;font:500 12px var(--sans);color:#7a6656;background:none;border:1px solid rgba(60,30,10,.2);border-radius:999px;padding:3px 12px;cursor:pointer}
.xp-x:hover,.xp-x:focus-visible{border-color:#e07a3a;color:#22130a;outline:none}
.xp h2{margin:0;font:400 25px/1.1 var(--serif);letter-spacing:-.01em;text-wrap:balance}
.xp-a{margin:0;font-size:15.5px}
.xp-n{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.xp-n li{font:500 12px var(--mono);background:rgba(194,85,27,.1);border-radius:6px;padding:2px 8px}
.xp-d{margin:0;color:#4a382c}
.xp-rel{margin:0;font-size:13px;color:#7a6656}
.xp-link{font:600 12.5px var(--mono);color:#b0521c;background:none;border:0;border-bottom:1px solid rgba(176,82,28,.35);padding:0 1px;margin:0 3px;cursor:pointer}
.xp-link:hover{color:#22130a;border-color:#22130a}
.xp-h{margin:0 0 5px;font:600 10.5px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:#9a5a24}
.xp-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.xp-b{border:1px solid rgba(60,30,10,.22);background:#fff;border-radius:999px;padding:5px 13px;font:500 12.5px var(--sans);cursor:pointer;color:#24140a}
.xp-b:hover,.xp-b:focus-visible{border-color:#e07a3a;outline:none}
.xp-b[aria-pressed=true]{background:#c2410c;border-color:#c2410c;color:#fff}
.xp-b.go{background:#22130a;border-color:#22130a;color:#fff6ec}
.xp-b.danger{color:#a3361a;border-color:rgba(163,54,26,.35);background:none}
.xp select,.xp input,.xp textarea{font:14px var(--sans);color:#22130a;background:#fff;border:1px solid rgba(60,30,10,.2);border-radius:9px;padding:7px 10px;min-width:0;width:100%}
.xp-acts select{width:auto;border-radius:999px;padding:4px 10px;font-size:12.5px}
.xp textarea{min-height:96px;resize:vertical;line-height:1.45}
.xp :is(select,input,textarea):focus-visible{outline:2px solid #e07a3a;outline-offset:1px}
.xp-saved{font:11.5px var(--mono);color:#9a8676;min-height:1em}
.xp-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0;padding:0;list-style:none}
.xp-tags li{display:inline-flex;align-items:center;gap:2px;font-size:12.5px;border:1px solid rgba(60,30,10,.2);border-radius:999px;padding:1px 4px 1px 10px;background:#fff}
.xp-tags li button{border:0;background:none;cursor:pointer;color:#9a8676;font-size:15px;line-height:1;padding:0 5px}
.xp-tags input{width:190px;border-radius:999px;padding:3px 12px;font-size:12.5px}
.xp details{border-top:1px solid rgba(60,30,10,.12);padding-top:12px}
.xp summary{cursor:pointer;font:500 13px var(--sans);color:#7a6656}
.xp-form{display:grid;gap:10px;margin-top:12px}
.xp-form label{display:grid;gap:3px;font-size:12px;color:#7a6656;min-width:0}
.xp-form .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.xp-err{margin:0;color:#a3361a;font-size:13px}

/* The two tabs of an experiment's workspace: a page to read, on the workspace's white. */
.xw{max-width:820px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:14px;color:#22130a;font:14.5px/1.55 var(--sans);--xa:#a8541c}
.xw p{margin:0;max-width:74ch}
.xw section{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin-top:10px}
.xw h4{margin:0;font:400 21px/1.2 var(--serif);text-wrap:balance}
.xw-dim{color:#7a6656;font-size:13.5px}
.xw-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.xw-lab{font:600 10.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--xa)}
.xw-short{background:#faf3ea;border-radius:12px;padding:14px 16px;display:grid;gap:8px}
.xw-step{margin:0;display:grid;grid-template-columns:104px minmax(0,1fr);gap:6px 14px}
.xw-step.rule{border-top:1px solid rgba(34,19,10,.14);padding-top:10px}
.xw-step dt{font:600 10px/1.9 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--xa)}
.xw-step dd{margin:0;min-width:0}
.xw-preds{display:flex;flex-wrap:wrap;gap:4px 14px}
.xw-st{font:600 9.5px var(--mono);font-style:normal;letter-spacing:.08em;text-transform:uppercase;border:1px solid currentColor;border-radius:5px;padding:1px 6px;white-space:nowrap}
.xw-st.held{color:#22794f}.xw-st.failed{color:#b8322a}.xw-st.half{color:#9a6a08}.xw-st.open{color:#7a6656}
.xw-tw{overflow-x:auto;max-width:100%}
.xw table{border-collapse:collapse;font-size:13px}
.xw thead th{font:600 9.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:#7a6656;text-align:left;padding:6px 14px 6px 0;white-space:nowrap}
.xw tbody th,.xw td{border-top:1px solid rgba(34,19,10,.14);padding:7px 14px 7px 0;text-align:left;font-weight:400;white-space:nowrap}
.xw td{font:12.5px var(--mono);font-variant-numeric:tabular-nums}
.xw tr.baseline>*{color:#7a6656}
.xw tr.ours>*{background:#faf0fb}
.xw tr.ours>th{font-weight:500}
.xw-call{border-left:3px solid var(--xa);padding:2px 0 2px 13px}
.xw-check{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.xw-check li{display:grid;grid-template-columns:20px minmax(0,1fr);position:relative}
.xw-check i{font-style:normal;font-weight:700;color:#22794f}
.xw-check .no i{color:#9a6a08}
.xw-next{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.xw-next>div{border:1px solid rgba(34,19,10,.16);border-radius:12px;padding:12px 14px;display:grid;gap:6px;align-content:start}
.xw-next b{font:400 17px/1.2 var(--serif)}
.xw-next span{font-size:13px;color:#7a6656}
.xw-acts{display:flex;flex-wrap:wrap;gap:8px}
.xw-b,.xw-chip{font:500 12.5px var(--sans);color:#22130a;background:#fff;border:1px solid rgba(34,19,10,.25);border-radius:999px;padding:5px 13px;cursor:pointer}
.xw-b.go{background:#22130a;color:#fff6ec;border-color:#22130a}
.xw-b:hover,.xw-chip:hover,.xw-b:focus-visible,.xw-chip:focus-visible{border-color:var(--xa);outline:none}
.xw-err{color:#a3361a;font-size:13px}
.xw-fold{border-top:1px solid rgba(34,19,10,.14);margin-top:10px;padding-top:12px}
.xw-fold summary{cursor:pointer;font:400 19px/1.2 var(--serif)}
.xw-fold summary small{font:600 9.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:#7a6656;margin-left:8px}
.xw-fold>*+*{margin-top:10px}
.xw-md p+p{margin-top:8px}
.xw-none{border:1px dashed rgba(34,19,10,.3);border-radius:12px;padding:14px 16px;display:grid;gap:8px}
.xw-none p{font-size:13.5px;color:#5b4230}
.xw-asks{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-top:1px solid rgba(34,19,10,.14);margin-top:10px;padding-top:12px}
.xw-asks>span{font:600 10px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:#7a6656;margin-right:4px}
.xw-status{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;background:#eef5ef;border-radius:12px;padding:11px 15px}
.xw-status b{font:600 11px var(--mono);letter-spacing:.09em;text-transform:uppercase}
.xw-status.live{background:#fdf1dc}
.xw-stale{border:1px dashed #b7860b;color:#8a6508;border-radius:10px;padding:8px 12px;font-size:13px}
.xw-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.xw-tile{display:grid;gap:3px;align-content:end;min-height:92px;border-radius:10px;padding:10px 12px;background:radial-gradient(120% 100% at 50% 35%,#161c2c,#06080d 75%);color:#f3efe7;text-decoration:none}
.xw-tile b{font:600 13px var(--sans)}
.xw-tile small{font:10.5px/1.35 var(--mono);color:#a9b4c4}
a.xw-tile:hover,a.xw-tile:focus-visible{outline:2px solid var(--xa);outline-offset:2px}
.xw-cmd{margin:0;background:#0d1018;color:#f3efe7;border-radius:10px;padding:10px 13px;font:12.5px/1.5 var(--mono);overflow-x:auto;white-space:pre}
.xw-stages{list-style:none;margin:0;padding:0}
.xw-stages li{display:grid;grid-template-columns:18px 150px minmax(0,1fr);gap:4px 10px;align-items:baseline;border-top:1px solid rgba(34,19,10,.14);padding:8px 0}
.xw-stages i{width:9px;height:9px;border-radius:50%;background:#22794f;align-self:center}
.xw-stages .trouble i{background:#9a6a08}.xw-stages .running i{background:#d9822b;box-shadow:0 0 0 4px rgba(217,130,43,.22)}.xw-stages .waiting i{background:transparent;border:1.5px solid #a9998a}
.xw-stages b{font:600 12.5px var(--mono)}
.xw-files{list-style:none;margin:0;padding:0;display:grid;gap:5px;font-size:13px}
.xw-files li{display:flex;flex-wrap:wrap;gap:2px 12px;align-items:baseline}
.xw-files code{font:12px var(--mono);overflow-wrap:anywhere}
.xw-files span{color:#7a6656}
/* "Run and watch" as a post: one reading column, sections that zoom, charts under the sentence that points at them. */
.xo{max-width:660px;width:100%;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:16px;font-size:15.5px;line-height:1.6;--rule:rgba(34,19,10,.14);--dim:#7a6656;--wash:#f6f1ea}
.xo p{max-width:66ch}
.xo code{font:.86em var(--mono);background:var(--wash);padding:1px 5px;border-radius:4px}
.xo a{color:var(--xa);text-underline-offset:2px}
.xo em{color:var(--dim)}
.xo-bar{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid var(--rule);display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:8px 0;font:12px var(--mono);color:var(--dim)}
.xo-seg{display:inline-flex;border:1px solid rgba(34,19,10,.2);border-radius:999px;padding:2px}
.xo-seg button{font:500 12px var(--sans);border:0;border-radius:999px;background:none;color:var(--dim);padding:4px 13px;cursor:pointer}
.xo-seg button[aria-pressed="true"]{background:#22130a;color:#fff6ec}
.xo-seg button:focus-visible,.xo-step button:focus-visible,.xo-gist:focus-visible{outline:2px solid var(--xa);outline-offset:2px}
.xo-title{margin:6px 0 0;font:400 34px/1.1 var(--serif);letter-spacing:-.01em;text-wrap:balance}
.xo-tldr{border-left:3px solid var(--xa);padding-left:14px;font-size:16.5px}
.xw .xo-sec{gap:10px;margin-top:0;border-top:1px solid var(--rule);padding-top:13px}
.xo-head{display:flex;align-items:center;gap:10px;min-height:26px}
.xo-step{margin-left:auto;display:inline-flex;align-items:center;gap:7px}
.xo-step button{width:26px;height:26px;padding:0;border-radius:50%;border:1px solid rgba(34,19,10,.25);background:#fff;color:var(--dim);font:15px/1 var(--mono);cursor:pointer}
.xo-step button:hover:not(:disabled){border-color:var(--xa);color:#22130a}
.xo-step button:disabled{opacity:.3;cursor:default}
.xo-step .dots{display:inline-flex;gap:3px}
.xo-step .dots i{width:6px;height:6px;border-radius:50%;background:rgba(34,19,10,.16)}
.xo-step .dots i.on{background:var(--xa)}
.xo-gist{all:unset;display:block;cursor:zoom-in;border-radius:6px;max-width:66ch}
.xo-gist:hover{background:var(--wash);box-shadow:0 0 0 6px var(--wash)}
.xo-lv{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;animation:xo-in .24s ease-out}
.xo-lv.deep{border-left:2px solid var(--rule);padding-left:14px;font-size:14px}
@keyframes xo-in{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.xo-lv{animation:none}}
.xo-fig{margin:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.xo-fig figcaption{font-size:13px;line-height:1.5;color:var(--dim);max-width:70ch}
.xo-fig figcaption strong{color:#22130a;font-weight:600}
.xo-plot{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;overflow-x:auto}
.xo-plot svg{display:block;width:100%;min-width:520px;height:auto}
.xo-plot text{font:11px var(--mono);fill:var(--dim)}
.xo-plot text.ink{fill:#22130a}
.xo-plot .grid{stroke:var(--rule)}
.xo-plot .axis{stroke:var(--dim)}
.xo-plot .mark{stroke:#22130a;stroke-dasharray:2 4}
.xo-key{display:flex;flex-wrap:wrap;gap:4px 16px;font:12px var(--mono);color:var(--dim)}
.xo-key i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.xo-key i.line{height:0;width:16px;border-top:2.5px solid;border-radius:0;vertical-align:3px}
.xo-bars{display:grid;grid-template-columns:max-content minmax(40px,1fr) 30px max-content;gap:7px 12px;align-items:center;font-size:14px}
.xo-bars .track{height:14px;background:var(--wash);border-radius:3px}
.xo-bars .track i{display:block;height:100%;border-radius:3px}
.xo-bars .n{font:13px var(--mono);text-align:right;font-variant-numeric:tabular-nums}
.xo-bars .note{font:12px var(--mono);color:var(--dim)}
.xo-bars .strong{font-weight:600}
.xo-grid{display:grid;gap:6px 4px;align-items:center;font:12px var(--mono)}
.xo-grid .h{color:var(--dim);text-align:center;font-size:11px}
.xo-grid .h.left{text-align:left}
.xo-grid .name{font:13px var(--sans)}
.xo-grid .tot{text-align:right;font-variant-numeric:tabular-nums}
.xo-grid .cell{display:flex;gap:2px;justify-content:center}
.xo-grid .cell i{width:8px;height:20px;border-radius:2px}
.xo-grid .sep{grid-column:1/-1;border-top:1px solid var(--rule)}
.xo-list{margin:0;font:12.5px/1.65 var(--mono);background:var(--wash);border-radius:10px;padding:14px 16px;overflow-x:auto;font-variant-numeric:tabular-nums}
.xo-list .ok{color:#2f7d4f}.xo-list .bad{color:#c2452d;font-weight:600}
.xo-cmd{display:flex;gap:10px;align-items:center;background:var(--wash);border-radius:10px;padding:8px 10px 8px 16px}
.xo-cmd code{background:none;padding:0;flex:1;min-width:0;overflow-x:auto;white-space:nowrap;font-size:12.5px}
.xo .xw-files li{display:grid;gap:1px}
@media (max-width:600px){.xo-title{font-size:27px}.xo-bars{grid-template-columns:minmax(0,max-content) minmax(40px,1fr) 30px}.xo-bars .note{grid-column:1/-1;margin-top:-6px}.xo-bars .note:empty{display:none}}
@media (max-width:600px){.xw-step{grid-template-columns:minmax(0,1fr);gap:0 0}.xw-step dd{margin-bottom:6px}.xw-stages li{grid-template-columns:18px minmax(0,1fr)}.xw-stages li>span{grid-column:2}}

.xh{position:relative;background:linear-gradient(180deg,#17110d,#0b0807 420px);color:#f3efe7;font-family:var(--sans);--serif:var(--font-instrument-serif),'Instrument Serif',Georgia,serif;--sans:var(--font-geist-sans),Geist,system-ui,sans-serif;--mono:var(--font-geist-mono),'Geist Mono',ui-monospace,monospace}
.xh-head{display:grid;gap:10px;padding:22px max(16px,env(safe-area-inset-right,0px)) 6px max(16px,env(safe-area-inset-left,0px));max-width:1180px;margin:0 auto}
.xh-head h2{margin:0;font:400 30px/1.1 var(--serif)}
.xh-head h2 em{color:#ffd2a8;font-style:italic}
.xh-head p{margin:0;color:#a9998a;font-size:13.5px;max-width:70ch}
.xh-dirs{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.xh-dir{display:inline-flex;align-items:center;gap:7px;font:500 12.5px var(--sans);color:#f3efe7;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:4px 11px 4px 9px;cursor:pointer}
.xh-dir i{width:9px;height:9px;border-radius:50%;background:var(--c);flex:none}
.xh-dir small{font:11px var(--mono);color:#a9998a}
.xh-dir[aria-pressed=true]{border-color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}
.xh-dir[aria-pressed=false] i{opacity:.4}
.xh-dir:hover,.xh-dir:focus-visible{border-color:#ffd2a8;outline:none}
.xh-new{display:inline-flex;gap:6px;align-items:center}
.xh-new input{font:12.5px var(--sans);color:#f3efe7;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:4px 12px;width:170px}
.xh-find{font:13px var(--sans);color:#f3efe7;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:5px 14px;width:min(320px,100%)}
.xh-scroll{overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:#4a3020 transparent}
.xh-field{position:relative;margin:0 auto}
.xh-field svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.xh-name{position:absolute;top:14px;transform:translateX(-50%);font:400 19px/1 var(--serif);color:var(--c);white-space:nowrap;text-shadow:0 1px 8px #0b0807}
.xh-name small{font:10.5px var(--mono);color:#a9998a;margin-left:6px}
.xh-bar{position:absolute;left:0;right:0;height:0;border-top:2px solid #ffd2a8;box-shadow:0 0 18px 2px rgba(255,170,90,.35)}
.xh-bar span{position:absolute;top:0;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:10px;font:600 10.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:#e9dcc6;background:#17110d;border:1px solid #ffd2a8;border-radius:999px;padding:4px 14px;white-space:nowrap}
.xh-bar b{color:#ffd2a8;font-weight:600}
.xh-bar i{width:1px;height:11px;background:rgba(233,220,198,.4)}
.xh-month{position:absolute;transform:translate(-50%,-50%);font:600 10.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:#e9dcc6;background:#17110d;border:1px solid rgba(233,220,198,.25);border-radius:999px;padding:2px 10px;white-space:nowrap}
.xh-card{position:absolute;display:grid;grid-template-columns:64px minmax(0,1fr);gap:9px;align-items:start;text-align:left;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#1a140f;color:#f3efe7;padding:8px 10px 8px 8px;cursor:pointer;overflow:hidden;box-shadow:0 8px 22px rgba(0,0,0,.35)}
.xh-card:hover,.xh-card:focus-visible{border-color:var(--c);outline:none;background:#211912}
.xh-card.dim{opacity:.25}
.xh-pic{width:64px;height:64px;border-radius:8px}
.xh-text{display:grid;gap:4px;min-width:0}
.xh-brow{display:flex;align-items:center;gap:6px;font:500 10.5px var(--mono);color:#a9998a;white-space:nowrap;overflow:hidden}
.xh-brow b{font:700 12.5px var(--mono);color:var(--c)}
.xh-brow i{width:7px;height:7px;border-radius:50%;background:var(--s);flex:none}
.xh-brow em{font-style:normal;color:var(--s)}
.xh-q{font:400 15.5px/1.15 var(--serif);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.xh-flag{position:absolute;top:0;right:10px;font:600 9px var(--mono);letter-spacing:.06em;text-transform:uppercase;background:#ff8a4c;color:#1a0d05;border-radius:0 0 5px 5px;padding:1px 6px}
.xh-start{position:absolute;transform:translate(-50%,0);font:11px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:#a9998a;white-space:nowrap}
`;
