import { missionBase } from './mission-css';

// The Board and Overview in the Mission theme. Their root is `<div className="mi dark">`:
// the `dark` class turns on Tailwind's dark variants for the panels they still share
// with the rest of the site, and the remapped slate/gray/indigo scales below pull
// those panels onto the HUD palette without restyling each one.
const RETINT = `
.mi{
--color-slate-50:#eef6ff;--color-slate-100:#e6f1ff;--color-slate-200:#c9d8ec;--color-slate-300:#b7c6dc;--color-slate-400:#8a9bb5;
--color-slate-500:#7d8ea8;--color-slate-600:#3a4d6a;--color-slate-700:#1d3049;--color-slate-800:#0f1d31;--color-slate-900:#081325;--color-slate-950:#040a16;
--color-gray-50:#eef6ff;--color-gray-100:#e6f1ff;--color-gray-200:#c9d8ec;--color-gray-300:#b7c6dc;--color-gray-400:#8a9bb5;
--color-gray-500:#7d8ea8;--color-gray-600:#3a4d6a;--color-gray-700:#1d3049;--color-gray-800:#0f1d31;--color-gray-900:#081325;--color-gray-950:#040a16;
--color-indigo-50:#e0f9ff;--color-indigo-100:#c2f2ff;--color-indigo-200:#9cebff;--color-indigo-300:#7fe3ff;--color-indigo-400:#5fd3f5;
--color-indigo-500:#38bde8;--color-indigo-600:#0f7fa3;--color-indigo-700:#0b6584;--color-indigo-800:#0b4a61;--color-indigo-900:#0a3446;--color-indigo-950:#061f2b}
`;

/** Pieces both pages use: section heads, the amber "needs you" box, striped "more" rows, logos at other sizes. */
const SHARED = `
.mi-body{padding:20px 18px 34px;display:flex;flex-direction:column;gap:30px}
@media(min-width:1100px){.mi-body{padding:22px 28px 40px}}
.mi .sech{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:6px 14px;margin:0 0 12px}
.mi .sech h2,.mi .sech h3{margin:0;font:400 32px/1 var(--serif);letter-spacing:-.01em;color:var(--ink)}
.mi .sub{font:11.5px var(--mono);color:var(--dim)}
.mi .hint{font-size:13px;color:var(--dim)}
.mi .co{font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mi .ro{font-size:12.5px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mi .logo.lg{width:48px;height:48px;border-radius:14px}.mi .logo.lg.letter{font-size:26px}
.mi .logo.sm img{width:72%;height:72%}
.mi .btn.now{background:var(--now);color:#1a0f00;border-color:transparent}
.mi .btn.danger{color:var(--c-reject);border-color:color-mix(in srgb,var(--c-reject) 45%,transparent)}
.mi .kind.off{color:var(--dim);box-shadow:inset 0 0 0 1px var(--line2);background:repeating-linear-gradient(-45deg,transparent 0 4px,rgba(120,190,255,.05) 4px 8px)}
.mi .eb{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font:11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--em)}
.mi .hero{position:relative;overflow:hidden;padding:20px 22px}
.mi .hero::before{content:"";position:absolute;inset:-60% -20% auto;height:120%;background:radial-gradient(closest-side,rgba(57,184,255,.14),transparent);pointer-events:none}
.mi .hero>*{position:relative}
.mi .cap{border-radius:20px;padding:18px;display:grid;gap:14px;background:radial-gradient(120% 90% at 100% 0%,color-mix(in srgb,var(--now) 16%,transparent),transparent 60%),var(--glass);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--now) 45%,transparent),0 20px 60px -30px color-mix(in srgb,var(--now) 70%,transparent)}
.mi .pulse{width:8px;height:8px;border-radius:50%;background:var(--now);flex:none;box-shadow:0 0 0 4px color-mix(in srgb,var(--now) 22%,transparent)}
.mi .more{display:flex;gap:10px;align-items:center;width:100%;border-radius:14px;padding:11px 14px;color:var(--ink2);font-size:13px;text-align:left;box-shadow:inset 0 0 0 1px var(--line);background:repeating-linear-gradient(-45deg,transparent 0 6px,var(--glass2) 6px 12px)}
.mi .more:hover{color:var(--ink);box-shadow:inset 0 0 0 1px var(--line2)}
.mi .empty{color:var(--dim);padding:22px;text-align:center;border-radius:16px;box-shadow:inset 0 0 0 1px var(--line);background:repeating-linear-gradient(-45deg,transparent 0 6px,var(--glass2) 6px 12px)}
.mi .err{border-radius:14px;padding:10px 14px;color:#ffd0d0;background:color-mix(in srgb,var(--c-reject) 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c-reject) 45%,transparent);font-size:13.5px}
.mi .leg{display:flex;flex-wrap:wrap;gap:4px 16px;font:12px var(--mono);color:var(--ink2)}
.mi .leg>span{display:inline-flex;gap:6px;align-items:center}
.mi .leg>span::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--k);box-shadow:0 0 6px var(--k)}
.mi .tl{list-style:none;margin:0;padding:0;display:grid}
.mi .tl>li{border-top:1px dashed var(--line)}
.mi .tl>li:first-child{border-top:0}
.mi .seg{flex-wrap:wrap}
@media (prefers-reduced-motion: reduce){.mi *{animation:none!important;transition:none!important}}
`;

export const MISSION_JOBS_CSS = missionBase('mi') + RETINT + SHARED;
