// Sunrise's look: Horizon Dawn's colours and type, the forms on the rings (from the mockup in the Handwired
// experiment repo), and the hero's own box. Everything is nested under .sr-hero, so nothing leaks into the page.
// The engine (engine.ts) puts these state classes on .sr-sky: ready, narrow, shapes, hovering, settling, working,
// resizing.
import {partsCss} from '@/lib/shapes/parts-css'

const rules = String.raw`
.sr-flat{position:absolute;left:0;top:0;z-index:1;display:block}
.sr-flat .you{font:500 10px var(--mono);letter-spacing:2px;fill:#5a2a08}
.sr-flat .dcount{font:500 9px var(--mono);letter-spacing:1.4px;fill:#7a3a10}
.sr-threads{position:absolute;left:0;top:0;width:100%;height:100%;z-index:3;pointer-events:none}
.sr-threads line{stroke-width:1.4;stroke-linecap:round}
.sr-threads line.lead{stroke-width:2}
.sr-labels{position:absolute;inset:0;z-index:4;pointer-events:none;opacity:0;transition:opacity .5s ease}
.ready .sr-labels{opacity:1}
/* One element per thing: pill, teaser, hook or lead, and it grows between them. */
.thing{position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;border-radius:14px;border:1px solid transparent;overflow:hidden;
  transition:translate var(--t) var(--ease),width var(--t) var(--ease),height var(--t) var(--ease),border-radius var(--t) var(--ease),background-color .6s ease,color .6s ease,border-color .6s ease,box-shadow .6s ease,opacity .6s ease,scale .3s ease;will-change:translate,width,height}
.resizing .thing,.resizing .sr-pane{transition:none!important}
.thing .face{height:26px;display:flex;align-items:center;justify-content:center;gap:0;padding:0 11px;white-space:nowrap;font:500 13px var(--sans)}
.thing .face b{font-weight:inherit;overflow:hidden;text-overflow:ellipsis}
.thing .face .t{font-weight:400;opacity:.72;margin-left:5px}
.thing .face .when{font:10.5px var(--mono);opacity:.7;margin-left:auto;padding-left:10px}
.thing .body{opacity:0;transition:opacity .35s ease;padding:2px 14px 12px}
.thing .d{position:absolute;left:50%;top:30px;transform:translateX(-50%);font:10.5px var(--mono);color:#e6ecf4;opacity:.8;white-space:nowrap}
.thing{overflow:visible}
.thing.hook{overflow:hidden}
.thing.hook .d{display:none}
.thing.gone{opacity:0;pointer-events:none}
.thing.in-sun{opacity:0;pointer-events:none;border-radius:50%}
/* Zones, as Dawn's pills. */
.thing.ignition{background:var(--cream);color:var(--deep);box-shadow:0 0 18px 4px rgba(255,179,122,.32)}
.thing.climb{background:rgba(255,255,255,.88);color:#10213a}
.thing.altitude{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.6);color:#eef2f8;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.thing.orbit{background:rgba(5,7,13,.2);border-color:rgba(255,255,255,.28);color:rgba(238,242,248,.78);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.thing.orbit .d{opacity:.55}
.thing.daily{background:rgba(255,236,214,.16);border-color:rgba(255,236,214,.5);color:#fff3e2;backdrop-filter:blur(4px)}
.thing.daily .d{display:none}
.thing.lv1 .face{font-weight:600}
.thing:not(.hook):hover{box-shadow:0 0 0 1.5px rgba(255,210,168,.75),0 0 22px 4px rgba(255,186,110,.3)}
/* Hooks: glass bubbles holding a real first step. The lead is lit like the sun's own light. */
.thing.hook{border-radius:20px;background:rgba(14,22,40,.5);border-color:rgba(255,236,214,.34);color:var(--ink);backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 18px 50px -18px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.12)}
.thing.hook .face{height:36px;justify-content:flex-start;padding:0 14px;font:600 13.5px var(--sans)}
.thing.hook .body{opacity:1;transition-delay:.25s}
.thing.hook:hover{border-color:rgba(255,210,168,.8)}
.thing.lv3.hook{background:linear-gradient(180deg,#fff8ef,#ffe9d2);color:var(--deep);border-color:rgba(255,255,255,.9);box-shadow:0 0 0 1px rgba(255,255,255,.5),0 0 34px 6px rgba(255,170,90,.35),0 20px 60px -20px rgba(0,0,0,.6)}
.thing.lv3.hook .face{font:400 22px/1 var(--serif);height:44px;padding-top:4px}
.thing.lv3.hook .face .when{font:10.5px var(--mono);color:#8a4a1c;opacity:1}
/* The lead breathes: a second, wider glow under it fades in and out. Fading a layer is nearly free; animating the
   box's own shadow repainted it on every frame. */
.sr-glow{position:absolute;left:0;top:0;border-radius:20px;pointer-events:none;opacity:0;visibility:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.7),0 0 60px 14px rgba(255,170,90,.55);
  transition:translate var(--t) var(--ease),width var(--t) var(--ease),height var(--t) var(--ease);will-change:opacity}
.sr-glow.on{visibility:visible;animation:sr-breathe 4.2s ease-in-out infinite}
.hovering .sr-glow,.working .sr-glow{animation:none;opacity:0}
/* Seats: a lifted thing's home on its ring. */
.seat{position:absolute;left:0;top:0;height:22px;border-radius:50%;background:radial-gradient(closest-side,rgba(255,214,170,.32),rgba(255,214,170,.1) 55%,rgba(255,214,170,0));opacity:0;transition:opacity .5s ease,transform var(--t) var(--ease);pointer-events:none}
.seat.on{opacity:1}
/* Ground labels, as Dawn's. */
.zl{position:absolute;left:0;top:0;text-align:center;color:#2a1d14;white-space:nowrap;pointer-events:none;transition:opacity .5s ease}
.zl b{display:block;font:italic 400 24px/1 var(--serif)}
.zl small{display:block;font:9.5px var(--mono);letter-spacing:1.4px;opacity:.7;margin-top:4px}
.sr-say h1{margin:0;font:400 clamp(26px,3vw,42px)/1.06 var(--serif);color:var(--ink);text-wrap:balance;transition:font-size .6s var(--ease)}
.sr-say h1 em{display:block;margin-top:8px;font:400 clamp(17px,1.5vw,21px)/1.3 var(--serif);color:var(--em)}
.sr-say p{margin:8px 0 0;font:12.5px/1.45 var(--mono);letter-spacing:.02em;color:var(--dim)}
.narrow .sr-say{left:16px;right:16px;top:14px;max-width:none}
.narrow .sr-say h1{font-size:24px}
.narrow .sr-say p{font-size:11px;margin-top:4px}
.narrow .thing .face{font-size:12px;padding:0 9px}
.narrow .thing.lv3.hook .face{font-size:19px}
.narrow .zl b{font-size:19px}
/* Nothing vanishes: a folded pill stays as a faint bubble where it was. */
.thing.ghost{opacity:.28;pointer-events:auto}
.thing.ghost .face b,.thing.ghost .face .t{opacity:0}
.thing.ghost .d{opacity:0}
.thing.ghost:hover{opacity:.7}
.thing.ghost:hover .face b{opacity:1}
/* A faint bubble is pressed only where it is drawn: its folded body hangs below it, unseen, and must not take a press meant for the task under it. */
.thing.ghost .body{pointer-events:none}
/* Started marks. */
.thing.started:not(.hook)::after{content:"";position:absolute;right:-3px;top:-3px;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle,#ffb37a 0 40%,rgba(255,140,60,.25) 41% 100%);box-shadow:0 0 8px 2px rgba(255,150,70,.6)}
.thing.started.hook{border-color:rgba(255,170,100,.8)}
input.need{border-color:#e0572a!important;box-shadow:0 0 0 3px rgba(224,87,42,.2)}
/* Subjects at the rim. */
.sl-subject{position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;border:0;background:none;padding:3px 6px;border-radius:999px;font:500 10px var(--mono);letter-spacing:1.6px;color:#d6dde8;white-space:nowrap;opacity:.78;transition:opacity .4s ease,transform var(--t) var(--ease),background .2s ease}
.sl-subject small{margin-left:6px;font:inherit;color:var(--em);letter-spacing:0}
.sl-subject:hover{opacity:1;background:rgba(255,255,255,.08)}
.sl-subject.here{opacity:1;color:var(--em)}
.sl-subject.off{opacity:0;pointer-events:none}
/* The sections under the sun, named below the horizon as the classes are above it. */
.sl-track{position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;border:0;background:none;border-radius:999px;padding:3px 6px;font:500 10px var(--mono);letter-spacing:1.6px;color:#ffe2c4;white-space:nowrap;opacity:.82;transition:opacity .4s ease,transform .5s ease}
.sl-track small{margin-left:6px;font:inherit;color:#ffb37a;letter-spacing:0}
.sl-track.empty{opacity:.6}
.sl-track:hover{opacity:1;background:rgba(255,255,255,.08)}
.sl-track.empty small{color:rgba(255,226,196,.6)}
.sl-track.off{opacity:0;pointer-events:none}
.working .sl-track{opacity:0;pointer-events:none}
.sr-back{display:inline-flex;margin:0 0 10px 8px;border:1px solid rgba(255,210,168,.45);background:rgba(10,14,24,.4);border-radius:999px;padding:3px 10px;font:500 11px var(--mono);color:var(--em);cursor:pointer}
.sr-back[hidden]{display:none}
/* The ground: chips you can press. */
.sr-ground{position:absolute;z-index:8;display:flex;gap:8px;flex-wrap:nowrap}
.chip{border:1px solid rgba(60,30,10,.25);background:rgba(255,246,236,.55);border-radius:999px;padding:5px 12px;font:12.5px var(--sans);color:#2a1408;cursor:pointer;white-space:nowrap}
.chip b{font-weight:600}
.chip.nodate{border-style:dashed;background:rgba(255,246,236,.35)}
.chip.hold{background:#2a1408;color:#ffe2c4;border-color:#2a1408}
.chip:hover{background:#fff6ec}
.chip.hold:hover{background:#3a1d0b}
.sr-streak{position:absolute;z-index:8;display:grid;justify-items:center;gap:3px;pointer-events:none}
.sr-streak span{display:flex;gap:3px;align-items:flex-end;height:20px}
.sr-streak i{width:7px;border-radius:2px;background:rgba(42,20,8,.35)}
.sr-streak i.now{background:#b0521c}
.sr-streak small{font:9.5px var(--mono);letter-spacing:.06em;color:rgba(42,29,20,.75)}
.sr-arcs{position:absolute;inset:0;z-index:6;pointer-events:none}
.sr-arcs[hidden]{display:none}
.arc{position:absolute;left:0;top:0;width:26px;height:14px;border:0;border-radius:8px;background:transparent;pointer-events:auto;cursor:pointer}
.arc:hover{background:rgba(255,246,236,.35)}
.sr-sunbtn{position:absolute;left:0;top:0;z-index:5;border:0;padding:0;background:none;border-radius:50%;cursor:pointer;clip-path:inset(0 0 50% 0)}
.sr-sunbtn:hover{box-shadow:0 0 0 1.5px rgba(255,246,232,.6),0 0 36px 12px rgba(255,186,110,.3)}
.sr-sunbtn[hidden]{display:none}
.sr-toast{position:absolute;left:50%;bottom:86px;z-index:30;transform:translate(-50%,10px);opacity:0;pointer-events:none;background:#24140a;color:#fff6ec;border-radius:999px;padding:7px 14px;font:13px var(--sans);transition:opacity .25s ease,transform .25s ease}
.sr-toast.on{opacity:1;transform:translate(-50%,0)}
.thing.hook.hot{z-index:6}
.hovering .thing.box:not(.hot),.hovering .thing.form:not(.hot),.hovering .thing.hook:not(.hot){scale:.9;opacity:.74}
.hovering .thing,.settling .thing{--t:.26s}
.thing.opened{opacity:0!important;pointer-events:none}
/* What the parts read their colours from. A thing's ring gives its form its light, as Dawn's pills: cream nearest
   the sun, white this week, glass further out. Opened, a form is lit like the lead. */
.shape{--fg:#eef2f8;--sub:rgba(238,242,248,.68);--accent:#ffd2a8;--line:rgba(255,255,255,.46);--fill:rgba(34,52,92,.74);--soft:rgba(255,255,255,.13);--hot:#ff8a45;--good:#8fe3b0;--good-soft:rgba(110,220,160,.16);
  color:var(--fg);font:500 12.5px/1.25 var(--sans);text-align:left}
.thing.ignition .shape{--fg:#1b0d05;--sub:rgba(27,13,5,.64);--accent:#c2551b;--line:rgba(255,255,255,.95);--fill:#fff6ec;--soft:rgba(27,13,5,.1);--hot:#d2451a;--good:#1f7a4a;--good-soft:rgba(31,122,74,.13)}
.thing.climb .shape{--fg:#10213a;--sub:rgba(16,33,58,.64);--accent:#b4521a;--line:rgba(255,255,255,.95);--fill:rgba(255,255,255,.9);--soft:rgba(16,33,58,.1);--hot:#d2451a;--good:#1f7a4a;--good-soft:rgba(31,122,74,.13)}
.thing.orbit .shape{--fg:rgba(238,242,248,.9);--line:rgba(255,255,255,.28);--fill:rgba(12,20,40,.6)}
.thing.daily .shape{--accent:#ffc48f;--line:rgba(255,226,196,.55);--fill:rgba(66,42,30,.66)}
.thing.form.lead .shape,.thing.form.hot .shape,.thing.hook .shape,.measure .shape{--fg:#1b0d05;--sub:rgba(27,13,5,.62);--accent:#b4521a;--line:rgba(255,255,255,.9);--fill:#fff3e2;--soft:rgba(27,13,5,.1);--hot:#d2451a;--good:#1f7a4a;--good-soft:rgba(31,122,74,.13)}
/* The element itself has no frame: the form inside draws its own outline. */
.shapes .thing.form{background:none;border:0;box-shadow:none;border-radius:0;overflow:visible;backdrop-filter:none;-webkit-backdrop-filter:none}
.thing.form>.face,.thing.form>.d,.shapes .thing.hook>.face{display:none}
.thing.form>.body,.shapes .thing.hook>.body{opacity:1;padding:0;height:100%;transition:none}
.thing.form .m{height:100%;display:grid;place-items:center}
.thing.form .f{display:none}
.shapes .thing.hook .m{display:none}
.shape.sm{zoom:var(--fz,1);display:flex;align-items:center;min-width:0}
.nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.wh{font:9.5px var(--mono);color:var(--sub);white-space:nowrap}
.ln{font-size:11px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sm .top{display:flex;align-items:baseline;gap:7px;min-width:0}
.sm .top .wh,.sm .top .count{margin-left:auto}
.sm .top .nm{flex:0 1 auto}
.sm .top .wh{flex:0 100 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
/* pill: a glass bubble holding a name and one line. */
.s-pill.sm,.s-card.sm,.s-stage.sm{flex-direction:column;align-items:stretch;justify-content:center;gap:1px;padding:0 17px;border-radius:999px;background:var(--fill);border:1px solid var(--line);box-shadow:0 8px 22px -14px rgba(0,0,0,.7)}
/* orb: a circle around one value, ring, time or person, with its name on a tail. */
.s-orb.sm .core{flex:none;position:relative;z-index:1;width:72px;height:72px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--fill);border:1px solid var(--line);box-shadow:0 8px 22px -12px rgba(0,0,0,.7)}
.s-orb.sm .core b{font:400 31px/1 var(--serif);color:var(--accent)}
.s-orb.sm .core b.time{font-size:22px;font-variant-numeric:tabular-nums}
.s-orb.sm .core small{font:8.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--sub)}
.s-orb.sm .core .p-ring{width:62px;height:62px}
.s-orb.sm .core .p-ring b{font:500 13px var(--mono);color:var(--fg)}
.s-orb.sm .core.face-of{background:radial-gradient(circle at 35% 30%,#ffd9a8,#e07a3a);border-color:rgba(255,255,255,.8)}
.s-orb.sm .core.face-of b{color:#3a1606}
.s-orb.sm .tail{flex:1;min-width:0;height:46px;margin-left:-18px;padding:0 15px 0 26px;border-radius:0 999px 999px 0;display:flex;flex-direction:column;justify-content:center;gap:1px;background:var(--fill);border:1px solid var(--line);border-left:0}
/* band: a strip along time or steps. */
.s-band.sm{flex-direction:column;align-items:stretch;justify-content:center;gap:5px;padding:0 18px;border-radius:24px;background:var(--fill);border:1px solid var(--line);box-shadow:0 8px 22px -14px rgba(0,0,0,.7)}
.s-band.sm .p-timeline{padding:2px 2px 0}
.s-band.sm .p-timeline .track{height:8px}
.s-band.sm .p-timeline .mark span{bottom:auto;top:-1px;left:calc(100% + 6px);font-size:9.5px;line-height:10px;color:var(--fg)}
.s-band.sm .p-timeline .ticks{margin-top:3px;font-size:8.5px}
.s-band.sm .p-steps li{padding-top:12px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s-band.sm .p-steps li::before{width:8px;height:8px}
.s-band.sm .p-steps li::after{left:8px;top:3.5px}
.s-band.sm .path{display:flex;gap:6px}
.s-band.sm .stop{flex:1 0 auto;position:relative;padding-top:11px;display:flex;flex-direction:column;font-size:10.5px;line-height:1.25;white-space:nowrap;color:var(--sub)}
.s-band.sm .stop b{font-weight:500}
.s-band.sm .stop span{font:9.5px var(--mono)}
.s-band.sm .stop::before{content:"";position:absolute;left:0;top:0;width:7px;height:7px;border-radius:50%;background:var(--sub);opacity:.6;z-index:1}
.s-band.sm .stop::after{content:"";position:absolute;left:9px;right:-4px;top:3px;height:1.5px;background:var(--soft)}
.s-band.sm .stop:last-child::after{display:none}
.s-band.sm .stop.now{color:var(--fg)}
.s-band.sm .stop.now b{font-weight:600}
.s-band.sm .stop.now::before,.s-band.sm .stop.done::before{background:var(--accent);opacity:1}
.s-band.sm .stop.now::before{box-shadow:0 0 0 2.5px color-mix(in srgb,var(--accent) 35%,transparent)}
/* tile: a picture first, its name over the foot of it. */
.s-tile.sm{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:#0d1626;box-shadow:0 8px 22px -12px rgba(0,0,0,.7)}
.s-tile.sm>.p-media,.s-tile.sm>.p-code,.s-tile.sm>.blank{width:100%;height:100%;border-radius:0}
.s-tile.sm .art{height:100%;border-radius:0}
.s-tile.sm .art.look-slides{padding:6px 6px 36px;gap:4px}
.s-tile.sm .art .play{width:28px;height:28px;font-size:10px;top:-16px}
.s-tile.sm .art .progress{bottom:34px}
.s-tile.sm figcaption,.s-tile.sm .p-code .name{display:none}
.s-tile.sm .p-code{height:100%}
.s-tile.sm .p-code pre{padding:6px 8px;font-size:8.5px;line-height:1.5}
.s-tile.sm .cap{position:absolute;left:0;right:0;bottom:0;padding:18px 9px 5px;display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;align-items:baseline;background:linear-gradient(rgba(5,8,18,0),rgba(5,8,18,.9) 55%);color:#eef2f8}
.s-tile.sm .cap .ln{grid-row:2;grid-column:1/-1;color:rgba(238,242,248,.74);font-size:10.5px}
.s-tile.sm .cap .wh{grid-row:1;grid-column:2;color:rgba(238,242,248,.8)}
/* note: a passage in serif on a sheet with one square corner. */
.s-note.sm{position:relative;flex-direction:column;align-items:stretch;justify-content:center;gap:4px;padding:6px 14px 6px 28px;border-radius:18px 18px 18px 3px;background:var(--fill);border:1px solid var(--line);box-shadow:0 8px 22px -14px rgba(0,0,0,.7)}
.s-note.sm::before{content:"“";position:absolute;left:8px;top:4px;font:400 36px/1 var(--serif);color:var(--accent)}
.s-note.sm .q{font:400 15px/1.14 var(--serif);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.s-note.sm .by{display:flex;align-items:baseline;gap:7px;font-size:10px;min-width:0}
.s-note.sm .by .nm{font-weight:500;color:var(--sub);flex:1}
.s-note.sm .by .wh{margin-left:auto}
/* list: its name, and the next rows each a small bubble of its own. */
.s-list.sm{flex-direction:column;align-items:flex-start;justify-content:center;gap:4px}
.s-list.sm .top{align-self:stretch;height:26px;align-items:center;padding:0 13px;border-radius:999px;background:var(--fill);border:1px solid var(--line);box-shadow:0 8px 22px -14px rgba(0,0,0,.7)}

.s-list.sm .row{max-width:calc(100% - 16px);height:22px;margin-left:16px;padding:0 11px 0 7px;display:flex;align-items:center;gap:6px;border-radius:999px;font-size:11px;background:var(--fill);border:1px solid var(--line)}
.s-list.sm .row span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s-list.sm .row .box{flex:none;width:11px;height:11px;border-radius:3px;border:1.5px solid var(--sub)}
.s-list.sm .row .dot{flex:none;width:6px;height:6px;margin:0 2px;border-radius:50%;background:var(--sub)}
.s-list.sm .row .dot.hot{background:var(--hot);box-shadow:0 0 6px var(--hot)}
/* What matters next after the lead has a warm rim, and the lead that found no room in the sky is lit. */
.thing.form.lv2 .shape.sm{--line:rgba(255,178,116,.98)}
/* Opened: under the pointer, and as the lead. */
.shapes .thing.form.hot,.measure.hot{z-index:6;border-radius:20px;background:linear-gradient(180deg,#fff8ef,#ffe9d2);border:1px solid #fff;box-shadow:0 0 0 1px rgba(255,255,255,.6),0 0 44px 8px rgba(255,170,90,.42),0 22px 50px -18px rgba(0,0,0,.65);overflow:hidden}
.thing.form.hot .m{display:none}
.thing.form.hot .f,.measure.thing.form .f{display:block}
.shape.full{display:flex;flex-direction:column;gap:10px;padding:12px 14px 14px;font-size:13px}
.shape.full .hd{display:flex;align-items:baseline;gap:8px;font-size:13.5px}
.shape.full .hd .nm{white-space:normal}
.shape.full .hd .wh{margin-left:auto;font-size:10.5px}
.thing.hook .shape.full,.measure.hook .shape.full{padding:14px 18px 16px;gap:12px}
.thing.hook .shape.full .hd,.measure.hook .shape.full .hd{font:400 23px/1.05 var(--serif)}
.thing.hook .shape.full .hd .nm,.measure.hook .shape.full .hd .nm{font-weight:400}
.thing.hook .shape.full .hd .wh,.measure.hook .shape.full .hd .wh{font:10.5px var(--mono)}
.shape.full .p-person .avatar,.shape.full .p-actions button:not(.quiet){color:var(--cream)}
.shape.full .p-media .art{height:96px}
.shape.full .p-dots{gap:22px}
.shape.full .p-dots i{flex:none;width:22px}
.measure-sm{position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;--fz:1;border:0;background:none;width:auto;height:auto;transition:none}
.measure{position:absolute;left:0;top:0;height:auto!important;visibility:hidden;pointer-events:none;transition:none!important;border:1px solid transparent}
/* ---- Every form reads the same way: its icon, where it belongs and what it is; its name; the picture; the next step. */
.brow{display:flex;align-items:center;gap:5px;min-width:0;font:500 9.5px var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--sub);white-space:nowrap}
.brow .icon{flex:none;width:11px;height:11px;color:var(--accent)}
.brow .kd{min-width:0;overflow:hidden;text-overflow:ellipsis}
.brow .wh{margin-left:auto;padding-left:10px;font:500 9.5px var(--mono);letter-spacing:0;text-transform:none;color:var(--fg);opacity:.9}
.nx{font-size:11px;font-weight:500;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nx::before{content:"→ "}
.shape.sm .nm{font-size:12.5px;line-height:1.25}
.s-orb.sm .tail{height:60px;gap:1px;padding:0 16px 0 27px}
.s-pill.sm{gap:1px;border-radius:26px}
.s-orb.sm .core small{font-size:7.5px;letter-spacing:.04em}
.s-orb.sm .core .p-ring b{font:500 10.5px var(--mono)}
.s-band.sm{gap:2px;padding:0 17px}
.s-band.sm .path{margin:3px 0 1px}
.s-band.sm .stop{padding-top:10px;line-height:1.2}
.s-tile.sm{display:grid;grid-template-rows:minmax(0,1fr) auto}
.s-tile.sm>.p-media,.s-tile.sm>.p-code,.s-tile.sm>.blank{min-height:0;height:auto;overflow:hidden}
.s-tile.sm .p-media{display:block}
.s-tile.sm .art.look-slides{padding:5px;gap:4px}
.s-tile.sm .art .play{top:0;width:26px;height:26px}
.s-tile.sm .art .progress{bottom:0}
.s-tile.sm .p-code pre{padding:4px 8px}
.s-tile.sm .cap{position:static;display:flex;flex-direction:column;gap:1px;padding:4px 9px 5px;background:#0b1120;--fg:#eef2f8;--sub:rgba(238,242,248,.66);--accent:#ffc48f;color:var(--fg)}
.s-tile.sm .cap .wh{position:static;grid-area:auto;padding:0 0 0 10px;background:none;border-radius:0;color:var(--fg)}
.s-note.sm{gap:2px;padding:6px 14px}
.s-note.sm::before{display:none}
.s-note.sm .q{margin:2px 0 1px;padding-left:8px;border-left:2px solid var(--accent);font:400 14px/1.14 var(--serif);-webkit-line-clamp:2}
.s-list.sm{gap:3px}
.s-list.sm .top{height:auto;display:flex;flex-direction:column;align-items:stretch;gap:1px;padding:5px 13px 6px;border-radius:17px}
.s-list.sm .nmrow{display:flex;align-items:baseline;gap:8px;min-width:0}
.s-list.sm .nmrow .nm{flex:1}
.s-list.sm .count{flex:none;font:9.5px var(--mono);color:var(--sub)}
.s-list.sm .row{height:21px}
.s-list.sm .row em{font-style:normal;margin-left:6px;color:var(--accent);font-weight:500}
.s-list.sm .row em::before{content:"→ "}
.shape.full .brow{font-size:10px}
.shape.full .brow .icon{width:13px;height:13px}
.shape.full .hd{display:block;margin-top:-5px}
.shape.full .what{margin:-4px 0 0;font-size:12.5px;line-height:1.4;color:var(--sub)}
.thing.hook .shape.full .what,.measure.hook .shape.full .what{font-size:13px}

/* ---- Forms are one row tall (70 before the screen's scale): the picture sits beside the words. */
.brow{font-size:10px}
.s-pill.sm{padding:0 16px;gap:1px}
.s-orb.sm .core{width:66px;height:66px}
.s-orb.sm .core b{font-size:28px}
.s-orb.sm .core .p-ring{width:56px;height:56px}
.s-orb.sm .tail{height:56px}
.s-tile.sm{display:grid;grid-template-columns:92px minmax(0,1fr);grid-template-rows:minmax(0,1fr);background:var(--fill);border-radius:16px}
.s-tile.sm>.p-media,.s-tile.sm>.p-code,.s-tile.sm>.blank{height:100%;border-radius:0}
.s-tile.sm .art,.s-tile.sm .art.look-slides{height:100%}
.s-tile.sm .art.look-slides{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;padding:5px;gap:3px}
.s-tile.sm .art.look-slides i:first-child{grid-row:1/3}
.s-tile.sm .p-code pre{padding:6px 7px;font-size:7.5px}
.s-tile.sm .cap{justify-content:center;background:none;padding:0 13px 0 11px;--fg:inherit;--sub:inherit;--accent:inherit;color:inherit;min-width:0}
.thing .s-tile.sm .cap{color:var(--fg)}
.s-note.sm{padding:0 15px;gap:1px}
.s-note.sm .q{margin:1px 0;font:italic 400 13.5px/1.2 var(--serif);-webkit-line-clamp:1;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s-band.sm{padding:0 16px;gap:1px;border-radius:22px}
.s-band.sm .path{display:flex;gap:0;margin:1px 0;font-size:10.5px;white-space:nowrap;overflow:hidden}
.s-band.sm .stop{flex:none;flex-direction:row;align-items:baseline;gap:4px;padding:0;color:var(--sub)}
.s-band.sm .stop::before{position:static;align-self:center;width:6px;height:6px;margin-right:1px}
.s-band.sm .stop::after{position:static;content:"›";background:none;height:auto;margin:0 6px;color:var(--sub)}
.s-band.sm .stop span{font:9.5px var(--mono)}
.s-list.sm .top{padding:4px 13px 5px}
/* ---- Hooks: what OpenClaw already did, ticked off above the piece of work. */
.shape.full .did{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11.5px;line-height:1.4;color:var(--sub)}
.shape.full .did span{width:100%;font:500 9.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
.shape.full .did i{font-style:normal}
.shape.full .did i::before{content:"✓ ";color:var(--good)}
.shape.full .p-rows .done .text{text-decoration:none}
.shape.full .p-quote{font-size:17px}
.shape.full .p-code pre span{white-space:pre-wrap}
/* The tray: what a chip on the ground or the sun opens. Its contents are drawn by React. */
/* The tray. */
.sr-tray{position:absolute;z-index:20;width:min(380px,calc(100% - 20px));padding:14px;border-radius:16px;background:#fff8ef;color:#24140a;box-shadow:0 18px 50px -12px rgba(0,0,0,.55);font:13px var(--sans)}
.sr-tray[hidden]{display:none}
.sr-tray .t{margin:0;font:400 22px/1.1 var(--serif)}
.sr-tray .s{margin:4px 0 10px;color:#7a6656}
.sr-tray .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.sr-tray .letgo input{flex:1;min-width:160px;height:30px;border-radius:999px;border:1px solid rgba(60,30,10,.2);padding:0 12px;font:12.5px var(--sans);outline:none}
.sr-tray .u{display:flex;align-items:center;gap:5px;padding:6px 0;border-top:1px solid #efe5d9}
.sr-tray .u span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px dashed rgba(60,30,10,.35);border-radius:999px;padding:3px 10px}
.sr-tray .list{margin:8px 0 0;padding-left:18px;display:grid;gap:4px}
.sr-tray .list li.did{text-decoration:line-through;color:#9a8676}
.sr-tray label.daily{display:flex;gap:8px;align-items:center;padding:5px 0;cursor:pointer}
/* ---- The hero's own box: a tall stage in the page, the ground strip at its foot. */
.sr-sky{position:relative;overflow:hidden;outline:none;background:#05070d;height:clamp(560px,62vw,min(860px,100svh))}
@media (max-width:699px){.sr-sky{height:min(760px,calc(100svh - var(--app-header-h,48px)))}}
.sr-sky:focus-visible{box-shadow:inset 0 0 0 2px #ffd2a8}
.sr-loading{position:absolute;inset:0;display:grid;place-items:center;font:13px var(--sans);color:var(--dim);z-index:2;pointer-events:none}
.sr-day{position:absolute;inset:0;z-index:2;pointer-events:none;opacity:0;transition:opacity .8s ease;background:radial-gradient(120% 90% at 50% 100%,rgba(255,196,128,.3),rgba(120,160,215,.2) 45%,rgba(40,70,120,.08) 80%)}
.working .sr-day{opacity:1}
.sr-say{position:absolute;left:3%;top:22px;max-width:min(36%,calc(97% - 340px));z-index:6;pointer-events:none}
.sr-say .sr-back{pointer-events:auto}
.sr-cap{position:absolute;right:3%;top:22px;width:clamp(280px,30%,400px);z-index:7}
.narrow .sr-cap{left:16px;right:16px;width:auto}
.working .thing.form,.working .thing.hook{scale:.88;opacity:.5}
.working .sl-subject{opacity:0;pointer-events:none}
.thing.leaving{pointer-events:none}
/* A narrow screen: tasks are bubbles with their name; the lead opens on a shelf under the words. */
.narrow .thing:not(.hook){border-radius:14px}
/* The opened form's one button. */
.shape.full .p-actions .go{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* The workspace: a task opened in place. What it holds is drawn by React (TaskPane). */
.sr-pane{position:absolute;left:0;top:0;z-index:12;width:0;height:0;border-radius:16px;opacity:0;pointer-events:none;overflow:hidden;
  background:linear-gradient(180deg,#fff8ef,#ffefdc);color:#24140a;
  box-shadow:0 0 0 1px rgba(255,255,255,.6),0 0 90px 20px rgba(255,170,90,.32),0 30px 70px -30px rgba(0,0,0,.7);
  transition:translate .7s var(--ease),width .7s var(--ease),height .7s var(--ease),border-radius .7s ease,opacity .3s ease}
.sr-pane.risen{opacity:1;border-radius:24px;pointer-events:auto}
.resizing .sr-pane{transition:none!important}
.sr-pane-in{position:absolute;inset:0;overflow:auto;opacity:0;transition:opacity .25s ease}
.sr-pane.risen .sr-pane-in{opacity:1;transition:opacity .4s ease .3s}
/* A phone: a task's workspace is the whole screen, fixed to the window over the page and its bar, and exactly the
   part of it the keyboard leaves (TaskPane sets --vvh and --vvt from the visual viewport). It slides up into place
   instead of growing out of the task's form. The engine adds .full when a task opens on a narrow sky. */
.narrow>.sr-pane.full{position:fixed;left:0;top:var(--vvt,0px);z-index:65;width:100%!important;height:var(--vvh,100dvh)!important;translate:none!important;transform:translateY(28px);
  border-radius:0;box-shadow:none;background:#fff8ef;overscroll-behavior:none;transition:opacity .25s ease,transform .32s var(--ease)}
.narrow>.sr-pane.full.risen{border-radius:0;transform:none}
.narrow>.sr-pane.full .sr-pane-in{overflow:hidden;overscroll-behavior:none;transition:opacity .2s ease}
.narrow>.sr-pane.full.risen .sr-pane-in{transition:opacity .25s ease .08s}
.sr-b{border:1px solid rgba(60,30,10,.2);background:#fff;border-radius:999px;padding:5px 11px;font:500 12.5px var(--sans);cursor:pointer;color:#24140a}
.sr-b:hover{border-color:#e07a3a}
/* The far side: press the sun and the sky rolls over about the horizon to where the action cards are. */
.turn-out .sr-labels,.turn-out .sr-threads{transform-origin:50% var(--hy,90%);animation:sr-turn-out .3s ease-in forwards}
.turn-in .sr-labels,.turn-in .sr-threads{transform-origin:50% var(--hy,90%);animation:sr-turn-in .44s cubic-bezier(.2,.8,.2,1) both}
.turn-out .sr-flat{opacity:.55;transition:opacity .3s ease}
.sr-flat{transition:opacity .3s ease}
.sr-sunbtn{clip-path:inset(-40px -120px 50% -120px)}
.sr-sunbtn .l{position:absolute;left:50%;bottom:calc(100% + 10px);transform:translateX(-50%);font:500 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:#fff3e2;white-space:nowrap;opacity:0;text-shadow:0 1px 6px rgba(0,0,0,.55);pointer-events:none;transition:opacity .2s ease}
.sr-sunbtn:hover .l,.sr-sunbtn:focus-visible .l{opacity:1}
.sr-sunbtn:focus-visible{outline:none;box-shadow:0 0 0 1.5px rgba(255,246,232,.6),0 0 36px 12px rgba(255,186,110,.3)}
.farside .zl{color:#f6e6ee}
.farside .chip{background:rgba(255,236,244,.7)}
.thing.is-card.noticed .shape.sm{--line:rgba(134,230,216,.8)}
.thing.is-card.handed .shape.sm .nm::after{content:" · OpenClaw on it";font-weight:500;color:#2bb8a3}
/* The camera: a pinch zooms the world and a two-finger scroll moves it. The flat drawing moves with it. */
.sr-world{position:absolute;inset:0;z-index:3;pointer-events:none;transform-origin:0 0}
.sr-flat{transform-origin:0 0;overflow:visible}
.sr-ground,.sr-sunbtn{pointer-events:auto}
/* Touch: over the sky one finger moves the camera and two pinch it (engine.ts), so the browser neither scrolls nor
   zooms there; when the camera can go no further, the engine scrolls the page itself. It is on the sky itself, a
   still box under everything, because the drawing moves and shrinks with the camera. touch-action is the
   intersection of an element's and its ancestors' up to the nearest scroller, so whatever scrolls in the tray, the
   capture box or the workspace (a list, the workspace's own column) still scrolls natively, up and down. */
.sr-sky{touch-action:none}
.sr-tray .sr-cards{touch-action:pan-y}
button{touch-action:manipulation}
/* Zoomed, everything is drawn again at its new size (a kept layer would be stretched and blurry), and the words
   step back so the sky can be looked around. */
.zoomed .thing,.zoomed .sr-glow{will-change:auto}
.sr-say{transition:opacity .25s ease}
.zoomed .sr-say{opacity:0}
.thing.veiled{opacity:0!important;pointer-events:none;transition:opacity .35s ease}
.zoomed .thing.veiled{opacity:1!important;pointer-events:auto}
.gliding .sr-world,.gliding .sr-flat{transition:transform .34s cubic-bezier(.22,.8,.24,1)}
.sr-ctl{position:absolute;left:50%;top:12px;z-index:9;transform:translateX(-50%);display:flex;gap:6px;align-items:center}
.sr-ctl button{border:1px solid rgba(255,255,255,.2);background:rgba(10,14,24,.5);color:rgba(243,239,231,.78);border-radius:999px;padding:4px 12px;font:500 11px var(--mono);cursor:pointer;white-space:nowrap;transition:border-color .15s ease,color .15s ease,background .15s ease}
.sr-ctl button:hover,.sr-ctl button:focus-visible{border-color:#ffd2a8;color:#fff;outline:none}
.sr-ctl button.on{background:#ffd2a8;border-color:#ffd2a8;color:#1b0d05}
.sr-ctl .sr-view{background:rgba(10,14,24,.88);border-color:rgba(255,255,255,.35);color:#f3efe7}
.sr-ctl [hidden]{display:none}
.hz-on3d .sr-ctl,.working .sr-ctl,.narrow .sr-lock{display:none}
/* Under the sun: what is behind today, in the ground's own light. Late tasks have a hot rim, undated ones a dashed
   one, and what was cleared this week is dim and struck through. */
.thing.under .shape{--fg:#ffe9d2;--sub:rgba(255,233,210,.66);--accent:#ffb37a;--line:rgba(255,190,140,.45);--fill:rgba(46,24,12,.8);--soft:rgba(255,255,255,.1);--hot:#ff8a45;--good:#8fe3b0;--good-soft:rgba(110,220,160,.14)}
.thing.under.late .shape{--line:rgba(255,120,60,.9);--accent:#ff9a6a}
.thing.under.nodate .shape.sm{border-style:dashed}
.thing.under.cleared{cursor:default}
.thing.under.cleared .shape{--fg:rgba(255,233,210,.62);--fill:rgba(30,22,16,.62);--line:rgba(255,255,255,.18);--accent:#8fe3b0}
.thing.under.cleared .nm{text-decoration:line-through}
/* On a phone the things under the sun are bubbles, in the same light. */
.narrow .thing.under:not(.hook){background:rgba(46,24,12,.8);border-color:rgba(255,190,140,.45);color:#ffe9d2}
/* The week's streak under the sun opens the dailies. */
.sr-streak{pointer-events:auto;cursor:pointer;border:0;background:none;padding:2px 6px;border-radius:8px}
.sr-streak:hover,.sr-streak:focus-visible{background:rgba(255,246,236,.35);outline:none}
.sr-streak[hidden]{display:none}
/* The ground's chips wrap on a narrow screen. */
.narrow .sr-ground{flex-wrap:wrap;right:12px}
.chip.more{background:rgba(255,246,236,.3)}
.sr-full svg{display:none}
.sr-safe{position:absolute;left:0;top:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none}
/* ---- A phone. Everything a finger presses is at least 44px to the touch, however small it is drawn. */
/* The controls sit in the top right corner, out of the headline's first line, and stay readable over a sky that
   has moved under them. Full page is just its icon. */
.narrow .sr-ctl{left:auto;right:8px;top:6px;transform:none;gap:4px}
.narrow .sr-ctl button{position:relative;height:36px;padding:0 13px;background:rgba(10,14,24,.86);border-color:rgba(255,255,255,.3);color:#f3efe7;box-shadow:0 4px 14px -6px rgba(0,0,0,.7)}
.narrow .sr-ctl button::after{content:"";position:absolute;inset:-4px -2px}
.narrow .sr-ctl button.on{background:#ffd2a8;border-color:#ffd2a8;color:#1b0d05}
.narrow .sr-ctl .sr-full{width:36px;padding:0;display:grid;place-items:center}
.narrow .sr-full span{display:none}
.narrow .sr-full svg{display:block;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.narrow .sr-say h1::before{content:"";float:right;width:36px;height:28px}
.sr-say .sr-dl{pointer-events:auto;position:relative;border:0;background:none;padding:0;font:inherit;letter-spacing:inherit;color:var(--em);text-decoration:underline dotted;text-underline-offset:3px;cursor:pointer}
.sr-say .sr-dl::after{content:"";position:absolute;inset:-15px -6px}
.narrow .sr-back{position:relative}
.narrow .sr-back::after{content:"";position:absolute;inset:-12px -4px}
/* Once the camera moves, the capture box steps back with the words (unless it is being typed in). */
.narrow .sr-cap{transition:opacity .25s ease}
.narrow.zoomed .sr-cap:not(:focus-within){opacity:0;pointer-events:none}
/* The lead is its name and its one button: the headline above already says what it is about. */
.narrow :is(.thing.hook,.measure.hook) .shape.full{padding:12px 16px 14px;gap:9px}
.narrow :is(.thing.hook,.measure.hook) .shape.full>:not(.brow,.hd,.p-actions){display:none}
.narrow :is(.thing.hook,.measure.hook) .shape.full .hd{font-size:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.narrow .thing:not(.hook)::before{content:"";position:absolute;inset:-8px -2px}
.narrow :is(.sl-track,.sl-subject)::after{content:"";position:absolute;inset:-13px -4px}
/* The chips share their line with the chat button in the corner; the dailies open from the headline's count. The
   arcs on the sun are drawn, not pressed: there a finger means the sun. */
.narrow .sr-ground{right:auto;max-width:calc(100% - 84px);gap:6px}
.narrow .chip{position:relative;padding:5px 11px;font-size:12px}
.narrow .chip::after{content:"";position:absolute;inset:-8px -3px}
.narrow .sr-streak{display:none}
.narrow .arc{pointer-events:none}
/* Pulled back, the names grow back toward their own size (--lk), each only as far as it has room to (--k): engine.ts
   setView and roomToGrow. */
.narrow.zoomed .thing:not(.hook),.narrow.zoomed .sr-ground{scale:min(var(--lk,1),var(--k,1))}
/* A faint bubble a finger tapped shows its name; the next tap opens it. */
.thing.ghost.peek{opacity:.9}
.thing.ghost.peek .face b{opacity:1}
/* A tray is a sheet at the foot of the window, whatever opened it: it scrolls inside, and a press outside or its
   ✕ closes it. */
.sr-tray .sr-x{display:none}
.narrow .sr-tray{position:fixed;left:0!important;right:0;bottom:0!important;z-index:66;width:auto!important;max-height:min(70svh,560px);overflow:auto;overscroll-behavior:contain;touch-action:pan-y;
  border-radius:18px 18px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -14px 44px -10px rgba(0,0,0,.6);font-size:14px}
.narrow .sr-tray .sr-x{position:sticky;top:-4px;float:right;z-index:1;display:grid;place-items:center;width:40px;height:40px;margin:-8px -6px 0 8px;border:0;border-radius:50%;background:rgba(60,30,10,.08);color:inherit;font:400 18px/1 var(--sans);cursor:pointer}
.narrow .sr-tray .sr-cards{max-height:none!important;overflow:visible}
.narrow .sr-tray input{font-size:16px}
.narrow .sr-tray .letgo input{height:40px}
/* A finger cannot hover: the sun's name is always there, small, just over it (a phone keeps its bubbles clear of it). */
@media (pointer:coarse){
  .sr-sunbtn .l{bottom:calc(100% + 3px);opacity:.8;font-size:9px;letter-spacing:.1em}
  /* On the far side the sun already says TODAY. */
  .farside .sr-sunbtn .l{display:none}
}
`

export const SUNRISE_CSS = `
.sr-hero{--ink:#f3efe7;--dim:#a9b4c4;--em:#ffd2a8;--signal:#ff7a2f;--cream:#fff6ec;--deep:#1b0d05;--serif:var(--font-instrument-serif),'Instrument Serif',Georgia,serif;--sans:var(--font-geist-sans),Geist,system-ui,sans-serif;--mono:var(--font-geist-mono),'Geist Mono',ui-monospace,monospace;--t:.9s;--ease:cubic-bezier(.22,.8,.24,1);display:block;position:relative;background:#05070d;color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;color-scheme:dark;
*{box-sizing:border-box}
button{font:inherit;color:inherit}
${partsCss}
${rules}
}
/* A long press on the sky moves nothing and selects nothing. */
@media (any-pointer:coarse){.sr-hero :is(.sr-flat,.sr-world,.sr-say,.sr-ctl){-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}}
@keyframes sr-breathe{0%,100%{opacity:0}50%{opacity:1}}
@keyframes sr-turn-out{to{opacity:0;transform:perspective(1400px) rotateX(-64deg)}}
@keyframes sr-turn-in{from{opacity:0;transform:perspective(1400px) rotateX(64deg)}to{opacity:1;transform:none}}
`
