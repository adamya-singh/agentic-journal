// The hover brief's look (glance.ts): a compact card in the lit form's cream, its next step the one raised line.
// The form's own colours (--fg, --sub, --accent) come from sunrise-css.ts's rules for an opened form.
export const GLANCE_CSS = String.raw`
.thing.form.hot .f:has(>.gl){height:100%}
.shape.full.gl{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:7px;padding:12px 14px 0;font:13px/1.35 var(--sans);overflow:hidden}
.gl .brow{flex:none}
.gl-nm{flex:none;margin-top:-2px;font:400 21px/1.08 var(--serif);color:var(--fg);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gl-when{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font:500 12.5px/1.3 var(--sans);color:var(--fg)}
.gl-left{flex:none;font:500 10.5px var(--mono);font-style:normal;padding:2px 8px;border-radius:999px;background:rgba(27,13,5,.08);color:var(--fg);white-space:nowrap}
.gl-left.ignition{background:var(--accent);color:#fff}
.gl-left.hold{background:#22130a;color:#ffd9b8}
.gl-flag{flex:none;margin:0;padding-left:9px;border-left:2px solid rgba(27,13,5,.2);font-size:12px;line-height:1.35;color:var(--sub);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gl-flag.warn{border-left-color:var(--hot);color:#8a2c0e;font-weight:500}
.gl-next{flex:none;display:grid;gap:2px;padding:8px 11px 9px;border-radius:12px;background:linear-gradient(180deg,#fff,#fff7ee);border:1px solid rgba(255,255,255,.95);box-shadow:inset 0 1px 0 #fff,0 8px 18px -12px rgba(120,60,10,.6),0 0 0 1px color-mix(in srgb,var(--accent) 22%,transparent)}
.gl-next span{font:500 9px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.gl-next b{font:600 13.5px/1.3 var(--sans);color:var(--fg);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gl-facts{flex:0 1 auto;min-height:0;overflow:hidden;margin:1px 0 0;display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr);gap:3px 12px;font-size:12px;line-height:1.35}
.gl-facts dt{color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px}
.gl-facts dd{margin:0;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gl-foot{flex:none;margin:auto -14px 0;display:flex;align-items:center;gap:8px;padding:8px 14px 9px;border-top:1px solid rgba(27,13,5,.09);font:11.5px var(--sans);color:var(--sub);white-space:nowrap}
.gl-chats{display:inline-flex;align-items:center;gap:6px;min-width:0}
.gl-chats i{flex:none;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 34% 30%,#fff,var(--accent))}
.gl-chats b{font-weight:500;color:var(--fg)}
.gl-chats em{font:10.5px var(--mono);font-style:normal;overflow:hidden;text-overflow:ellipsis}
.gl-chats.waiting em{color:var(--hot)}
.gl-open{margin-left:auto;font-weight:500;color:var(--accent)}
`
