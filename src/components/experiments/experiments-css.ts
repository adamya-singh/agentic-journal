// The Experiments page's own looks: the workspace an experiment opens into (cream, as a card to decide is on
// Sunrise) and the history under the horizon (the ground going down into the dark, one line per direction).
export const HUES = ['#f2b441', '#4cc3d9', '#ee6f8c', '#9d8cf7', '#57c78a', '#6aa6f8', '#f5804f', '#d58be8', '#b7c94a', '#a3aec6'] as const;
export const STATUS_COLOURS = { worked: '#3f9f6c', failed: '#d5484f', mixed: '#c98a12', finding: '#3f7fd6', running: '#7b8499' } as const;

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

.xp{position:absolute;inset:0;overflow:auto;background:linear-gradient(180deg,#fff9f0,#fbefdf);color:#22130a;font:14px/1.5 var(--sans);--a:#c2551b}
.xp-in{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;padding:14px 22px 26px}
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
.xp h2{margin:0;font:400 30px/1.08 var(--serif);letter-spacing:-.01em;text-wrap:balance}
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
