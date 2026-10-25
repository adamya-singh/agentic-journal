// Board B, the "flight deck": the pipeline as a trajectory across the hero, the
// questions as cards, a heard-back feed, and the stage table. Scoped under .mi.
export const BOARD_CSS = `
.mi .wk{display:flex;flex-wrap:wrap;gap:10px 16px;justify-content:space-between;align-items:center}
.mi .wk .eb{color:var(--dim)}
.mi .wk .eb b{font-weight:600;color:var(--ink)}
.mi .wk .eb .ok{color:var(--c-tech)}
.mi .wk .eb .bad{color:var(--c-reject)}
.mi .wk .linkbtn{color:var(--em);text-transform:uppercase;letter-spacing:.14em;font:600 11px var(--mono)}
.mi .wk .linkbtn:hover{text-decoration:underline}
.mi .run{margin-top:14px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 14px;align-items:center;width:100%;text-align:left;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--em) 7%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--em) 40%,transparent)}
.mi .run .step{font:600 10.5px var(--mono);letter-spacing:.13em;text-transform:uppercase;color:var(--em)}
.mi .next{margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.mi .next button{display:inline-flex;gap:6px;align-items:center;border-radius:999px;padding:3px 10px 3px 4px;font-size:12px;color:var(--ink2);box-shadow:inset 0 0 0 1px var(--line)}
.mi .next button:hover{box-shadow:inset 0 0 0 1px var(--line2);color:var(--ink)}
.mi .next .rk{font:500 10.5px var(--mono);color:var(--dim)}
.mi .track{position:relative;display:grid;grid-template-columns:repeat(5,minmax(0,1fr)) 28px repeat(2,minmax(0,.8fr));align-items:start;margin-top:24px}
.mi .track::before{content:"";position:absolute;left:7%;right:calc(28.5% + 14px);top:27px;height:2px;background:linear-gradient(90deg,var(--now),var(--c-other) 25%,var(--em) 50%,var(--c-tech) 75%,var(--c-screen));opacity:.55;box-shadow:0 0 12px rgba(127,227,255,.35)}
.mi .track .div{align-self:center;justify-self:center;height:56px;margin-top:-46px;border-left:1px dashed var(--line2)}
.mi .node{position:relative;display:grid;justify-items:center;align-content:start;gap:7px;text-align:center;padding:0 4px 6px;border-radius:16px;transition:background .15s}
.mi .node:hover{background:var(--hover)}
.mi .node .ring{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:#02050b;color:var(--k);box-shadow:inset 0 0 0 1.5px var(--k),0 0 22px -4px var(--k);transition:transform .15s}
.mi .node:hover .ring{transform:scale(1.05)}
.mi .node[aria-current=true] .ring{background:var(--k);color:#02050b;box-shadow:0 0 0 6px color-mix(in srgb,var(--k) 22%,transparent),0 0 30px -2px var(--k)}
.mi .node .ring svg.i{width:20px;height:20px}
.mi .node b{font:500 30px/1 var(--sans);font-variant-numeric:tabular-nums;color:var(--ink)}
.mi .node .l{font:600 10.5px var(--mono);letter-spacing:.13em;text-transform:uppercase;color:var(--k)}
.mi .node .s{font-size:12px;color:var(--dim);max-width:160px;line-height:1.35}
.mi .node.ghost .ring{box-shadow:inset 0 0 0 1.5px var(--line2);color:var(--dim)}
.mi .node.ghost[aria-current=true] .ring{background:var(--ink2);color:#02050b;box-shadow:0 0 0 6px var(--sel)}
.mi .node.ghost b{color:var(--ink2);font-size:24px}
.mi .node.ghost .l{color:var(--dim)}
@media(max-width:820px){
  .mi .track{grid-template-columns:repeat(4,minmax(0,1fr));row-gap:16px}
  .mi .track::before,.mi .track .div{display:none}
  .mi .node b{font-size:24px}.mi .node .ring{width:46px;height:46px}.mi .node .s{display:none}
}
.mi .applyto{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:20px 0 0;padding:16px 0 0;border:0;border-top:1px solid var(--line);min-width:0}
.mi .applyto legend{float:left;margin-right:6px}
.mi .chip{display:inline-flex;gap:8px;align-items:center;border-radius:999px;padding:6px 12px;font-size:13px;color:var(--dim);box-shadow:inset 0 0 0 1px var(--line2);background:repeating-linear-gradient(-45deg,transparent 0 5px,rgba(120,190,255,.04) 5px 10px)}
.mi .chip[aria-pressed=true]{color:var(--ink);background:var(--sel);box-shadow:inset 0 0 0 1px var(--em)}
.mi .chip:disabled{opacity:.5;cursor:not-allowed}
.mi .chip small{font:500 11px var(--mono);color:var(--dim)}
.mi .chip .dot{width:7px;height:7px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--dim)}
.mi .chip[aria-pressed=true] .dot{background:var(--em);box-shadow:0 0 8px var(--em)}
.mi .warn{flex-basis:100%;font-size:12.5px;color:var(--now)}
.mi .split{display:flex;flex-wrap:wrap;gap:26px;align-items:flex-start}
.mi .split>.main{flex:999 1 600px;min-width:0;display:grid;gap:14px}
.mi .split>.side{flex:1 1 320px;max-width:440px;min-width:0;display:grid;gap:16px}
@media(max-width:700px){.mi .split>.side{max-width:none}}
.mi .qgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.mi .qc{display:grid;gap:10px;align-content:start;padding:16px;border-radius:18px;background:var(--glass);box-shadow:inset 0 0 0 1px var(--line),inset 0 2px 0 -1px color-mix(in srgb,var(--now) 55%,transparent);transition:box-shadow .15s,transform .15s}
.mi .qc:hover{box-shadow:inset 0 0 0 1px var(--line2),inset 0 2px 0 -1px var(--now);transform:translateY(-1px)}
.mi .qc .nm{display:block;font:400 25px/1.05 var(--serif);color:var(--ink);overflow-wrap:anywhere;text-align:left}
.mi .qc .rl{display:block;font-size:13px;color:var(--ink2);margin-top:4px;text-align:left;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.mi .qc .ft{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px}
.mi .qc .w{flex:1 1 140px;font:11.5px var(--mono);color:var(--dim)}
.mi .qc .ft>span:last-child{margin-left:auto}
.mi .qmore{justify-content:center;flex-direction:column;gap:4px;min-height:140px;text-align:center}
.mi .qmore b{font:400 32px/1 var(--serif);color:var(--ink)}
.mi .feed>li>button{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:2px 12px;align-items:center;width:100%;text-align:left;padding:10px 4px;border-radius:10px}
.mi .feed>li>button:hover{background:var(--hover)}
.mi .feed .w{font:11px var(--mono);color:var(--dim);white-space:nowrap}
.mi .feed .st{grid-column:2/4;display:flex;gap:8px;align-items:center;min-width:0}
.mi .tblhead{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;margin-bottom:12px}
.mi .tbl{overflow:hidden}
.mi .trow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 14px;align-items:center;padding:10px 16px;border-top:1px solid var(--line);cursor:pointer;transition:background .15s}
.mi .trow:hover,.mi .trow.open{background:var(--hover)}
.mi .trow.h{display:none;cursor:default;border-top:0;background:none;padding-top:12px;padding-bottom:10px}
.mi .trow .cells{display:none}
.mi .trow .mob{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin-top:5px;font-size:12px;color:var(--dim)}
@media(min-width:1024px){
  .mi .trow{grid-template-columns:var(--cols)}
  .mi .trow.h{display:grid}
  .mi .trow .cells{display:contents}
  .mi .trow .mob,.mi .trow .mobonly{display:none}
}
.mi .trow .c{min-width:0;font-size:13px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mi .trow .c.m{font:12px var(--mono)}
.mi .trow .c.d{font:12px var(--mono);color:var(--dim)}
.mi .star{color:var(--dim);display:grid;place-items:center;width:28px;height:28px;border-radius:8px}
.mi .star:hover:not(:disabled){color:var(--now);background:var(--hover)}
.mi .star:disabled{opacity:.4;cursor:not-allowed}
.mi .star[aria-pressed=true]{color:var(--now)}
.mi .star[aria-pressed=true] svg{fill:var(--now)}
.mi .tags{display:flex;flex-wrap:wrap;gap:4px}
.mi .pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 6px 3px 10px;font:600 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;color:var(--k);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--k) 50%,transparent);background:color-mix(in srgb,var(--k) 8%,transparent)}
.mi .pill:hover{background:color-mix(in srgb,var(--k) 16%,transparent)}
.mi .pill svg.i{width:12px;height:12px}
.mi .det{display:grid;gap:20px;padding:16px 16px 18px;border-top:1px dashed var(--line);background:rgba(2,5,11,.45);font-size:13.5px;color:var(--ink2)}
@media(min-width:768px){.mi .det{grid-template-columns:1fr 1.3fr 1fr}}
.mi .det p{margin:6px 0 0;line-height:1.6}
.mi .det .notes{max-height:12rem;overflow-y:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.mi .det dl{margin:6px 0 0;display:grid;gap:3px;font-size:13px}
.mi .det dt{display:inline;color:var(--dim)}
.mi .det dd{display:inline;margin:0}
.mi .det .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.mi .det select{border-radius:10px;padding:5px 8px;background:rgba(0,0,0,.35);border:1px solid var(--line2);color:var(--ink);font-size:12px;font-weight:600}
.mi .pager{display:block;width:100%;padding:11px 16px;border-top:1px solid var(--line);font:12px var(--mono);color:var(--dim);text-align:center}
.mi .pager:hover{color:var(--em);background:var(--hover)}
`;
