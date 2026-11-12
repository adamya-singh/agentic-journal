// The look of the 3D world's layers (dawn-space.ts builds them inside the sky it is given): the backdrop, the
// canvas, the projected task tags, the way in and the heads-up display. Shared by Horizon Dawn and Sunrise.
// They read --hz-sans, --hz-serif and --hz-mono from the hero.
export const SPACE_CSS = `
.hz3d{position:absolute;inset:0;opacity:0;pointer-events:none}
.hz-on3d .hz3d{opacity:1}
.hz3d-bg{position:absolute;left:-100%;width:300%;top:0;height:100%;will-change:transform}
.hz3d-bg svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.hz3d canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.hz3d-lab{position:absolute;inset:0;z-index:2}
.hz3d-tg{position:absolute;left:0;top:0;pointer-events:none;will-change:transform,opacity}
.hz-live .hz3d-tg.hit{pointer-events:auto;cursor:pointer}
.hz3d-tg .p{display:flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border-radius:14px;font:500 13px var(--hz-sans);white-space:nowrap;border:1px solid transparent;box-sizing:border-box}
.hz3d-tg.big .p{font-weight:600}
.hz3d-tg .d{position:absolute;left:50%;top:100%;transform:translateX(-50%);font:10.5px var(--hz-mono);color:#e6ecf4;opacity:.8;white-space:nowrap}
.hz3d-tg.ignition .p{background:#fff6ec;color:#1b0d05;box-shadow:0 0 18px 4px rgba(255,179,122,.35)}
.hz3d-tg.climb .p{background:rgba(255,255,255,.88);color:#10213a}
.hz3d-tg.altitude .p{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.6);color:#eef2f8}
.hz3d-tg.orbit .p{background:transparent;border-color:rgba(255,255,255,.28);color:rgba(238,242,248,.75)}
.hz3d-tg.orbit .d{opacity:.55}
.hz3d-tg.hold .p{background:#120a06;border-color:#ff5a1f;color:#ff8a5c;font-weight:600}
.hz-live .hz3d-tg.hit:hover .p{filter:brightness(1.08)}
.hz3d-zl{position:absolute;left:0;top:0;pointer-events:none;text-align:center;color:#2a1d14;white-space:nowrap;will-change:transform}
.hz3d-zl b{display:block;font:italic 400 24px var(--hz-serif);line-height:1}
.hz3d-zl small{display:block;font:9.5px var(--hz-mono);letter-spacing:1.4px;opacity:.7;margin-top:4px}
.hz3d-you{position:absolute;left:0;top:0;font:10px var(--hz-mono);letter-spacing:2px;color:#5a2a08;pointer-events:none}
.hz3d-enter{position:absolute;right:24px;bottom:22px;z-index:7;display:flex;align-items:center;gap:9px;font:500 13px var(--hz-sans);color:#f3efe7;background:rgba(10,14,24,.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:8px 16px;cursor:pointer;transition:opacity .3s ease,transform .2s ease}
.hz3d-enter i{width:8px;height:8px;border-radius:50%;background:#ffd2a8;box-shadow:0 0 0 4px rgba(255,210,168,.2)}
.hz3d-enter:hover,.hz3d-enter:focus-visible{transform:translateY(-2px);border-color:#ffd2a8;outline:none}
.hz-live .hz3d-enter{opacity:0;pointer-events:none}
.hz3d-hud{position:absolute;left:0;right:0;bottom:0;z-index:7;display:flex;justify-content:space-between;align-items:flex-end;gap:10px;padding:14px 18px;pointer-events:none;flex-wrap:wrap;opacity:0;transition:opacity .4s ease}
.hz-live.hz-settled .hz3d-hud{opacity:1}
.hz3d-where{background:rgba(10,14,24,.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:8px 13px;min-width:200px;color:#f3efe7}
.hz3d-where .k{font:500 10px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:#a9b4c4}
.hz3d-where .v{font:italic 400 22px var(--hz-serif);line-height:1.15}
.hz3d-where .v span{font:11px var(--hz-mono);font-style:normal;color:#a9b4c4;margin-left:6px}
.hz3d-where .bar{height:2px;background:rgba(255,255,255,.15);margin-top:6px;border-radius:2px;overflow:hidden}
.hz3d-where .bar i{display:block;height:100%;width:0;background:#ffd2a8}
.hz3d-hint{font:12px var(--hz-sans);color:#d6dde8;background:rgba(10,14,24,.5);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:6px 12px}
.hz3d-btns{display:flex;gap:6px;pointer-events:auto}
.hz3d-btns button{font:500 12.5px var(--hz-sans);color:#f3efe7;background:rgba(10,14,24,.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 11px;cursor:pointer}
.hz3d-btns button:hover,.hz3d-btns button:focus-visible{border-color:#ffd2a8;outline:none}
/* The dailies on the sun, inside the world: the arcs to press and the count. */
.hz3d-ds,.hz3d-dl,.hz3d-dz{position:absolute;left:0;top:0;border:0;padding:0;background:transparent;pointer-events:none;will-change:transform,opacity}
.hz3d-dz{border-radius:50%}
.hz-live .hz3d-dz.hit{pointer-events:auto}
.hz3d-ds{width:26px;height:26px;border-radius:50%}
.hz3d-dl{font:10px var(--hz-mono);letter-spacing:1.6px;color:#ffe2c4;white-space:nowrap;padding:3px 8px;border-radius:999px}
.hz-live .hz3d-ds.hit,.hz-live .hz3d-dl.hit{pointer-events:auto;cursor:pointer}
.hz3d-dl.hit:hover,.hz3d-dl:focus-visible{background:rgba(10,14,24,.55);outline:none}
.hz3d-ds:hover::after,.hz3d-ds:focus-visible::after{content:attr(data-label);position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);font:500 12px var(--hz-sans);color:var(--hz-ink);background:rgba(10,14,24,.8);border:1px solid rgba(255,210,168,.5);border-radius:999px;padding:4px 11px;white-space:nowrap}
.hz3d-ds:focus-visible{outline:none;box-shadow:0 0 0 2px #ffd2a8}
`;
