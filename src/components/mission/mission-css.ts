// The Mission theme shared by the Jobs pages (Interviews casebook, Board, Overview):
// an Earthrise HUD panel that stays dark in either site theme. missionBase(scope)
// returns the tokens and primitives under .<scope>, so each page keeps its own root.
// The element reset sits in Tailwind's base layer so utility classes on buttons
// inside the panel (the Board's shared panels) still win over it.
export function missionBase(s: string) {
  return `
.${s}{--bg:#02050b;--ink:#e6f1ff;--ink2:#b7c6dc;--dim:#7d8ea8;--faint:#4a5872;--line:rgba(120,190,255,.12);--line2:rgba(120,190,255,.24);
--glass:linear-gradient(180deg,rgba(9,20,38,.78),rgba(4,10,22,.88));--glass2:rgba(120,190,255,.04);--hover:rgba(120,190,255,.07);
--em:#7fe3ff;--now:#ffb547;--sel:rgba(127,227,255,.08);--ghost:#7d8ea8;
--c-screen:#b59cff;--c-oa:#ffb547;--c-tech:#59f0c9;--c-ml:#6ec6ff;--c-behav:#ff8ac6;--c-fit:#c9f26b;--c-onsite:#ff9d6b;--c-other:#9fb3d1;--c-offer:#7dffb2;--c-reject:#ff6b6b;--c-applied:#7d8ea8;
--serif:var(--font-instrument-serif),'Instrument Serif',Georgia,serif;--mono:var(--font-geist-mono),'Geist Mono',ui-monospace,monospace;--sans:var(--font-geist-sans),Geist,ui-sans-serif,system-ui,sans-serif;
position:relative;isolation:isolate;color:var(--ink);font:14px/1.5 var(--sans);border-radius:20px;overflow:hidden;color-scheme:dark;
background:radial-gradient(160% 70% at 50% -42%,rgba(57,184,255,.30) 0,rgba(57,184,255,.07) 38%,transparent 39.2%),radial-gradient(160% 70% at 50% -40%,transparent 38.6%,rgba(127,227,255,.5) 39%,transparent 39.6%),linear-gradient(rgba(120,190,255,.035) 1px,transparent 1px) 0 0/100% 32px,linear-gradient(90deg,rgba(120,190,255,.035) 1px,transparent 1px) 0 0/32px 100%,#02050b;
box-shadow:0 30px 80px -30px rgba(0,0,0,.6),0 0 0 1px rgba(120,190,255,.1)}
@layer base{
.${s} *{box-sizing:border-box}
.${s} button,.${s} input,.${s} textarea,.${s} select{font:inherit;color:inherit}
.${s} button{cursor:pointer;background:none;border:0;padding:0}
}
.${s} :focus-visible{outline:2px solid var(--em);outline-offset:2px;border-radius:6px}
.${s} svg.i{width:16px;height:16px;flex:none;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.${s} svg.i.s{width:13px;height:13px}
.${s} .tn{font-variant-numeric:tabular-nums}
.${s} .mono{font-family:var(--mono)}
.${s} .lab{font:600 10.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.${s} .glass{background:var(--glass);border:1px solid var(--line);border-radius:18px;backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.${s}-top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px 16px;padding:14px 22px;border-bottom:1px solid var(--line)}
.${s}-title{font:400 30px/1 var(--serif);letter-spacing:-.01em}
.${s}-title i{color:var(--em)}
.${s} .kind{display:inline-flex;align-items:center;gap:6px;font:600 10.5px var(--mono);letter-spacing:.13em;text-transform:uppercase;border-radius:6px;padding:3px 8px;white-space:nowrap;color:var(--k,var(--em));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--k,var(--em)) 55%,transparent)}
.${s} .kind.solid{color:var(--bg);background:var(--k,var(--em));box-shadow:none}
.${s} .btn{display:inline-flex;align-items:center;gap:7px;border-radius:12px;padding:8px 14px;font-weight:600;font-size:13px;white-space:nowrap;border:1px solid var(--line2);color:var(--ink);background:var(--glass2);transition:transform .12s,border-color .12s}
.${s} .btn:hover{border-color:var(--em)}
.${s} .btn:active{transform:scale(.97)}
.${s} .btn:disabled{opacity:.45;cursor:not-allowed}
.${s} .btn.pri{background:var(--em);color:#021018;border-color:transparent}
.${s} .btn.sm{padding:5px 10px;font-size:12px;border-radius:10px}
.${s} .out{display:inline-flex;gap:6px;align-items:center;font:600 11px var(--mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.${s} .out i{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
.${s} .o-open{color:var(--c-screen)}.${s} .o-offer{color:var(--c-offer)}.${s} .o-rejected{color:var(--c-reject)}.${s} .o-no-reply,.${s} .o-withdrawn{color:var(--ghost)}.${s} .o-now{color:var(--now)}
.${s} .seg{display:inline-flex;border-radius:999px;padding:3px;gap:2px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line)}
.${s} .seg button{border-radius:999px;padding:5px 13px;font-weight:600;font-size:13px;color:var(--dim);display:inline-flex;gap:7px;align-items:baseline}
.${s} .seg button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.${s} .seg small{font:500 11px var(--mono);opacity:.7}
.${s} .search{display:flex;align-items:center;gap:9px;border-radius:12px;padding:8px 12px;background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line);color:var(--dim)}
.${s} .search input{border:0;outline:none;background:transparent;width:100%;color:var(--ink)}
.${s} .search kbd{font:11px var(--mono);border:1px solid var(--line2);border-radius:5px;padding:0 6px;color:var(--faint)}
.${s} .logo{display:inline-grid;place-items:center;flex:none;width:34px;height:34px;border-radius:10px;background:#fff;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 4px 14px -6px rgba(0,0,0,.6)}
.${s} .logo img{width:78%;height:78%;object-fit:contain}
.${s} .logo.letter{background:var(--glass2);box-shadow:inset 0 0 0 1px var(--line2);font:italic 400 19px/1 var(--serif);color:var(--ink)}
.${s} .logo.sm{width:24px;height:24px;border-radius:7px}.${s} .logo.sm.letter{font-size:14px}
.${s} .logo.xl{width:64px;height:64px;border-radius:18px}.${s} .logo.xl.letter{font-size:34px}
`;
}
