// The look of the shapes bank's parts (render.ts's renderPart). They take their colours from the element they sit in:
// --fg, --sub, --accent, --line, --fill, --soft, --hot, --good, --good-soft, and the fonts --serif and --mono.
export const partsCss = String.raw`
/* Parts. */
.p-line{font-size:12.5px;color:var(--sub);line-height:1.35}
.p-prose{margin:0;font-size:13.5px;line-height:1.5}
.p-quote{margin:0;font:400 19px/1.28 var(--serif);position:relative;padding-left:22px}
.p-quote::before{content:'“';position:absolute;left:-2px;top:-6px;font:400 44px/1 var(--serif);color:var(--accent)}
.p-quote cite{display:block;margin-top:6px;font:normal 10.5px var(--mono);color:var(--sub)}
.lv3 .p-quote{font-size:25px}
.p-value{display:flex;align-items:baseline;gap:6px}
.p-value b{font:400 36px/1 var(--serif)}
.p-value small{font:11px var(--mono);color:var(--sub)}
.p-value span{font-size:12px;color:var(--sub);margin-left:4px}
.p-value em{font:normal 500 10.5px var(--mono);border-radius:999px;padding:2px 7px;align-self:center;background:var(--good-soft);color:var(--good)}
.p-value em.down{background:var(--soft);color:var(--sub)}
.p-meter{display:grid;grid-template-columns:1fr auto;gap:5px 8px;font-size:12px;color:var(--sub)}
.p-meter em{font:normal 10.5px var(--mono)}
.p-meter u{grid-column:1/-1;height:6px;border-radius:3px;background:var(--soft);position:relative}
.p-meter u b{position:absolute;top:-4px;width:2px;height:14px;border-radius:1px;background:var(--fg);opacity:.7}
.p-meter u i{display:block;height:100%;border-radius:3px;background:var(--accent)}
.ring{position:absolute;inset:0;width:100%;height:100%}
.ring .track{stroke:var(--soft)}
.ring .fill{stroke:var(--accent)}
.p-ring{position:relative;width:58px;height:58px;display:grid;place-content:center}
.p-ring b{font:500 12px var(--mono)}
.p-spark{display:flex;flex-direction:column;gap:5px}
.p-spark>span{font:10px var(--mono);color:var(--sub)}
.chart{position:relative;height:40px}
.spark{display:block;width:100%;height:100%}
.spark .stroke{stroke:var(--accent);stroke-width:1.7}
.spark .area{fill:var(--accent);opacity:.14}
.chart .end{position:absolute;right:-3px;width:7px;height:7px;margin-top:-3.5px;border-radius:50%;background:var(--fg);box-shadow:0 0 0 2px var(--accent)}
.chart.bars{display:flex;align-items:flex-end;gap:4px;height:46px}
.chart.bars i{flex:1;border-radius:3px 3px 1px 1px;background:var(--accent);opacity:.38}
.chart.bars i.last{opacity:1}
.charted{display:flex;flex-direction:column;gap:3px}
.ticks{display:flex;font:9.5px var(--mono);color:var(--sub)}
.charted .ticks span{flex:1;text-align:center}
.p-dots{display:flex;gap:6px}
.p-dots i{flex:1;max-width:34px;display:grid;justify-items:center;gap:4px;font-style:normal}
.p-dots i::before{content:'';grid-area:1/1;width:100%;aspect-ratio:1;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--line)}
.p-dots b{grid-area:1/1;width:100%;aspect-ratio:1;border-radius:50%;background:var(--accent)}
.p-dots .today::before{box-shadow:inset 0 0 0 1.5px var(--line),0 0 0 2px var(--fill-solid,#10182c),0 0 0 3.5px var(--fg)}
.p-dots span{font:9.5px var(--mono);color:var(--sub);white-space:nowrap}
.p-rows{list-style:none;margin:0;padding:0}
.p-rows li{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 8px;padding:6px 0;border-top:1px solid var(--soft);font-size:13px;line-height:1.3}
.p-rows li:first-child{border-top:0;padding-top:0}
.p-rows .detail{margin-left:auto;font:10.5px var(--mono);color:var(--sub);white-space:nowrap}
.p-rows .box{flex:none;width:14px;height:14px;border-radius:4px;border:1.5px solid var(--sub);font:700 9px/11px var(--sans);text-align:center;align-self:center}
.p-rows .done .box{background:var(--accent);border-color:var(--accent);color:var(--deep)}
.p-rows .done .text{color:var(--sub);text-decoration:line-through}
.p-rows .more{font:10.5px var(--mono);color:var(--sub)}
.p-rows .text{flex:1;min-width:0}
.p-rows .hot .text::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--hot);margin-right:7px;vertical-align:2px;box-shadow:0 0 8px var(--hot)}
.p-rows .hot .detail{color:var(--hot)}
.p-rows .bar{flex-basis:100%;height:3px;border-radius:2px;background:var(--soft)}
.p-rows .bar i{display:block;height:100%;border-radius:2px;background:var(--accent)}
.p-pairs{margin:0;display:grid;grid-template-columns:auto 1fr;gap:5px 12px;font-size:13px}
.p-pairs dt{font:10.5px/1.7 var(--mono);color:var(--sub)}
.p-pairs dd{margin:0}
.p-steps{list-style:none;margin:0;padding:0;display:flex}
.p-steps li{flex:1;position:relative;padding-top:15px;font-size:11.5px;color:var(--sub);min-width:0}
.p-steps li::before{content:'';position:absolute;left:0;top:0;width:9px;height:9px;border-radius:50%;background:var(--soft);z-index:1}
.p-steps li::after{content:'';position:absolute;left:9px;right:0;top:4px;height:1.5px;background:var(--soft)}
.p-steps li:last-child::after{display:none}
.p-steps .done::before,.p-steps .done::after{background:var(--accent)}
.p-steps .now{color:var(--fg);font-weight:600}
.p-steps .now::before{background:var(--fg);box-shadow:0 0 0 3px var(--accent)}
.p-timeline{padding:20px 4px 4px;container-type:inline-size}
.lv1 .p-timeline{padding-top:18px}
.lv1 .p-segments b{font-size:16px}
.lv1 .p-value b{font-size:30px}
.s-stat.lv1 .heart .p-value b{font-size:34px}
@container (max-width:380px){.p-timeline .mark.point span{display:none}}
.p-timeline .track{position:relative;height:12px;border-radius:6px;background:var(--soft)}
.p-timeline .mark{position:absolute;top:0;height:100%;border-radius:6px;background:var(--accent)}
.p-timeline .mark.point{width:12px;border-radius:50%;translate:-6px 0;background:var(--fg);box-shadow:0 0 0 3px var(--accent)}
.p-timeline .ticks{justify-content:space-between;margin-top:9px}
.p-timeline .mark span{position:absolute;left:0;bottom:16px;font:normal 10.5px var(--mono);color:var(--sub);white-space:nowrap}
.p-timeline .mark span.low{bottom:auto;top:16px}
.p-timeline .now{position:absolute;top:-5px;width:2px;height:22px;border-radius:1px;background:var(--fg);box-shadow:0 0 10px 1px var(--accent)}
.p-segments{display:flex;gap:4px}
.p-segments i{display:flex;flex-direction:column;gap:3px;min-width:38px;font-style:normal;flex-basis:0}
.p-segments i::before{content:'';height:8px;border-radius:4px;background:var(--accent)}
.p-segments i:nth-child(2)::before{opacity:.72}
.p-segments i:nth-child(3)::before{opacity:.46}
.p-segments i:nth-child(n+4)::before{opacity:.26}
.p-segments b{font:400 20px/1 var(--serif);margin-top:3px}
.p-segments span{font:10px var(--mono);color:var(--sub);white-space:nowrap}
.p-chips{display:flex;flex-wrap:wrap;gap:5px}
.p-chips span{border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:11.5px}
.p-person{display:flex;align-items:center;gap:10px}
.p-person .avatar{flex:none;width:34px;height:34px;border-radius:50%;background:var(--accent);color:var(--deep);display:grid;place-content:center;font:400 19px var(--serif);font-style:normal}
.lv3 .p-person .avatar{color:var(--cream)}
.p-person b{display:block;font-weight:500;font-size:13.5px}
.p-person span{font-size:12px;color:var(--sub)}
.p-person .status{margin-left:auto;font:normal 500 10.5px var(--mono);border-radius:999px;padding:3px 8px 3px 7px;background:var(--good-soft);color:var(--good);white-space:nowrap}
.p-person .status::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:5px}
.p-media{margin:0;display:flex;flex-direction:column;gap:5px}
.p-media figcaption{font:10.5px var(--mono);color:var(--sub)}
.art{position:relative;height:92px;border-radius:12px;overflow:hidden;background:linear-gradient(135deg,#3b5a9a,#b4687a 60%,#f0b27a)}
.art.look-slides{display:flex;gap:6px;padding:8px;background:#141a2c}
.art.look-slides i{flex:1;min-width:0;border-radius:6px;background:#070a14;overflow:hidden}
.art.look-slides svg{display:block;width:100%;height:100%}
.art.look-video{background:radial-gradient(80% 90% at 30% 20%,#33446e,#0b1020 75%)}
.art.look-chart{background:rgba(5,7,13,.4);display:flex;align-items:flex-end}
.art.look-chart .chart{width:100%;height:80%}
.art .play{position:absolute;inset:0;margin:auto;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.9);color:#10213a;display:grid;place-content:center;font-size:13px;padding-left:3px}
.art .progress{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.2)}
.art .progress i{display:block;height:100%;background:#ff7a2f}
.p-code{background:#0a0e1a;color:#dfe7f3;border-radius:10px;overflow:hidden}
.p-code .name{font:500 10.5px var(--mono);padding:7px 12px;background:rgba(255,255,255,.07);color:rgba(223,231,243,.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-code pre{margin:0;padding:9px 12px;font:11.5px/1.55 var(--mono);counter-reset:line;overflow:hidden}
.p-code pre span{display:block;white-space:pre}
.p-code pre span::before{counter-increment:line;content:counter(line);display:inline-block;width:1.4em;margin-right:10px;text-align:right;color:rgba(223,231,243,.32)}
.p-clock{display:flex;align-items:center;gap:10px}
.p-clock>b{font:400 36px/1 var(--serif);font-variant-numeric:tabular-nums}
.p-clock>span{font:10.5px var(--mono);color:var(--sub)}
.p-clock .dial{position:relative;flex:none;width:40px;height:40px;display:grid;place-content:center;font-style:normal}
.p-clock .dial b{font-size:11px;padding-left:2px;color:var(--accent)}
.p-field{width:100%;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:13px;outline:none}
.p-actions{display:flex;gap:8px;flex-wrap:wrap}
.p-actions button{border:1px solid var(--accent);background:var(--accent);color:var(--deep);border-radius:999px;padding:8px 17px;min-height:36px;font:600 13px var(--sans);cursor:pointer;transition:scale .15s ease,filter .15s ease}
.p-actions button:hover{filter:brightness(1.1)}
.p-actions button:active{scale:.96}
.p-actions button.pressed{background:var(--good);border-color:var(--good);color:#06150c}
.p-actions button.quiet{background:none;border-color:var(--line);color:var(--fg);font-weight:500}
.lv3 .p-actions button:not(.quiet){color:var(--cream)}
.lv3 .p-actions button.quiet{border-color:rgba(27,13,5,.25)}
.p-embed{--sub:rgba(238,242,248,.6);color:#eef2f8;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.16);background:#0c1120}
.p-embed .bar{display:flex;align-items:center;gap:5px;padding:8px 11px;background:rgba(255,255,255,.07)}
.p-embed .bar i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.22)}
.p-embed .bar span{margin-left:8px;font:10.5px var(--mono);color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-embed .body{display:flex;gap:12px;padding:12px;min-height:170px}
.p-embed .rail{flex:none;width:17%;max-width:110px;display:flex;flex-direction:column;gap:7px}
.p-embed .rail i{aspect-ratio:16/10;border-radius:5px;background:rgba(255,255,255,.08)}
.p-embed .rail i.on{background:rgba(255,255,255,.16);box-shadow:0 0 0 1.5px #ffc48f}
.p-embed .sheet{flex:1;min-width:0;border-radius:8px;background:rgba(255,255,255,.05);display:flex;flex-direction:column;gap:10px;padding:18px}
.p-embed .sheet i{height:8px;border-radius:4px;background:rgba(255,255,255,.1)}
.p-embed .sheet i:first-child{height:18px;background:rgba(255,255,255,.22);margin-bottom:6px}
.p-embed .sheet span{margin-top:auto;font:10.5px var(--mono);color:var(--sub)}
.lv3 .p-embed .body{min-height:360px}
`
