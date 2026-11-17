// The look of coding-agent sessions in a task's chat pane: in the pane's own type, spacing and dawn colours (the
// .srk- classes in WorkspaceChats.tsx), so a Codex or Claude Code session reads like the OpenClaw chats beside it.
// Steps of the work are quiet one-line rows; what the agent says, and what it asks, stand out.

export const CODE_SESSIONS_CSS = `
/* The list: every chat with its agent's mark. */
.srk-row.srk-arow{grid-template-columns:28px minmax(0,1fr);column-gap:10px}
.srk-arow>.srs-app{grid-row:1/3;margin-top:1px}
.srk-arow>.srk-rowmain,.srk-arow>.srk-meta{grid-column:2}
.srk-row .l.needs{color:var(--a);font-weight:500}
.srk-row .l.failed{color:#a3361a}
.srk-pill.failed{background:#fbe6df;color:#a3361a}
.srk-pill.offline{background:rgba(34,19,10,.05);color:#8a6a52}
.srk-meta .where{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* New chat: which agent, then for a coding agent where it runs and what to do. */
.srk-new{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:grid;grid-template-columns:minmax(0,1fr);align-content:start;gap:12px;padding:2px 14px 16px}
.srk-new h4,.srk-lbl{margin:0;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.srk-agents{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.srp .srk-agent{position:relative;display:grid;grid-template-columns:28px minmax(0,1fr);gap:2px 10px;align-items:start;align-content:start;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.95);background:rgba(255,255,255,.7);box-shadow:0 1px 2px rgba(120,60,10,.08);color:#22130a;font:inherit;text-align:left;cursor:pointer}
.srk-agent .srs-app{grid-row:1/3;margin-top:1px}
.srk-agent b{font:600 13.5px/1.3 var(--sans)}
.srk-agent span.why{font-size:12px;line-height:1.4;color:#6a4a32}
.srk-agent span.why code{font:11px var(--mono);overflow-wrap:anywhere;background:rgba(120,70,30,.08);border-radius:4px;padding:0 3px}
.srk-agent span.lim{grid-column:2;font:10.5px var(--mono);color:#8a6a52}
.srk-agent span.lim.full{color:#a3361a}
.srp .srk-agent:hover:not(:disabled){background:#fff;border-color:color-mix(in srgb,var(--a) 35%,#fff)}
.srp .srk-agent[aria-checked=true]{background:#fff;border-color:var(--a);box-shadow:0 0 0 2px color-mix(in srgb,var(--a) 18%,transparent)}
.srp .srk-agent:disabled{cursor:default;background:rgba(255,255,255,.4);box-shadow:none}
.srk-agent:disabled b,.srk-agent:disabled .srs-app{opacity:.5}
.srk-agent span.acct{grid-column:2;font:10.5px var(--mono);color:#1f7a4a}
/* Signing in to an agent on this device. */
.srk-signin{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:10px 12px;border-radius:14px;border:1px solid color-mix(in srgb,var(--a) 30%,transparent);background:color-mix(in srgb,var(--a) 5%,#fff)}
.srk-signin .h{display:flex;align-items:center;gap:9px;min-width:0}
.srk-signin .h .srs-app{flex:none;width:24px;height:24px;border-radius:7px;font-size:8.5px}
.srk-signin .h b{font:600 13.5px var(--sans)}
.srk-signin .h small{margin-left:auto;font:500 9.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:#8a6a52;white-space:nowrap}
.srk-signin ol{margin:0;padding-left:20px;list-style:decimal;display:grid;gap:6px;font-size:13px;line-height:1.45;color:#22130a}
.srk-signin a{color:var(--a);font-weight:500}
.srk-signin .code{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px}
.srk-signin .code code{font:600 16px var(--mono);letter-spacing:.12em;padding:4px 10px;border-radius:8px;background:#fff;border:1px solid rgba(60,30,10,.18);user-select:all}
.srk-signin .row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.srk-signin .paste input{flex:1 1 220px;min-width:0;height:34px;padding:0 12px;border-radius:999px;border:1px solid rgba(60,30,10,.2);background:#fff;color:#22130a;font:13px var(--mono);outline:0}
.srk-signin .paste input:focus{border-color:var(--a)}
.srk-signin .alt{font-size:12px;color:#8a6a52}
.srk-signin .alt code{font:11.5px var(--mono)}
.srk-signin .ok{margin:0;font-size:13px;color:#1f7a4a}
.srk-signin .wait{margin:0;display:flex;align-items:center;gap:8px;font-size:12.5px;color:#5b4230}
.srk-signin .wait i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--a);animation:srp-pulse 1.4s ease-in-out infinite}
.srk-signin .srk-err{margin:0}
.srk-form{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:12px;border-radius:14px;border:1px solid rgba(60,30,10,.12);background:rgba(255,255,255,.6)}
.srp .srk-place{width:100%;max-width:none;height:34px;font-size:13px}
.srk-hint{margin:0;font-size:12px;color:#8a6a52;overflow-wrap:anywhere}
.srk-hint code{font:11.5px var(--mono)}
.srk-hint.own b{font-weight:600;color:#5b4230}
.srk-hint.own.full b{color:#8a2c1b}
.srk-form .srk-box textarea{min-height:64px;max-height:200px}
.srk-form .srk-on{flex-wrap:wrap;row-gap:6px}
.srk-form .srk-picks{margin-left:0;flex-wrap:wrap}
.srp .srk-linkish{justify-self:start;border:0;background:none;padding:2px 0;font:500 12.5px var(--sans);color:var(--a);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.srp .srk-linkish:disabled{color:#a08268;cursor:default;text-decoration:none}
.srk-natives{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:6px}
.srk-natives li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:8px 10px;border-radius:12px;background:#fff;border:1px solid rgba(60,30,10,.1)}
.srk-natives b{font:600 13px/1.3 var(--sans);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srk-natives span{grid-column:1;min-width:0;font:10.5px var(--mono);color:#8a6a52;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srk-natives p{grid-column:1;margin:0;font-size:12px;color:#6a4a32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.srk-natives li>button,.srk-natives li>em{grid-column:2;grid-row:1/4}
.srk-natives em{font:normal 11.5px var(--sans);color:#8a6a52}

/* One session: its head. */
.srk-ctitle{display:flex;align-items:flex-start;gap:9px;min-width:0}
.srk-ctitle .srs-app{flex:none;width:24px;height:24px;border-radius:7px;font-size:8.5px;margin-top:-1px}
.srk-ctitle b{flex:1;min-width:0;overflow-wrap:anywhere}
.srp .srk-more{flex:none;width:28px;height:24px;margin:-2px -4px 0 0;border:0;border-radius:8px;background:none;color:#6a4a32;font:600 16px/1 var(--sans);cursor:pointer}
.srp .srk-more:hover,.srp .srk-more[aria-expanded=true]{background:rgba(34,19,10,.07);color:#22130a}
.srk-meta button.srk-linkish{font-size:12px;padding:0}
.srk-menu{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-top:4px;padding:10px 12px;border-radius:12px;border:1px solid rgba(60,30,10,.14);background:#fffdfa;box-shadow:0 10px 24px -18px rgba(60,30,10,.6)}
.srk-menu .row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
.srk-menu input{flex:1 1 200px;min-width:0;height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(60,30,10,.2);background:#fff;color:#22130a;font:13px var(--sans);outline:0}
.srk-menu input:focus{border-color:var(--a)}
.srk-menu p{margin:0;font-size:12.5px;color:#5b4230}
.srk-menu pre{margin:0;padding:8px 10px;border-radius:9px;background:#22130a;color:#ffe9d2;font:12px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}
.srp .srk-menu .danger{color:#a3361a;border-color:color-mix(in srgb,#a3361a 35%,transparent)}

/* The log: turn after turn. */
.srk-clog{gap:12px}
.srk-turn{display:flex;flex-direction:column;gap:8px}
.srk-turn+.srk-turn{padding-top:12px;border-top:1px dashed rgba(60,30,10,.12)}
.srk-m.agent{align-self:stretch;max-width:100%;padding:0;background:none;border:0;border-radius:0;overflow-wrap:anywhere}
.srk-m.agent p,.srk-m.agent ul,.srk-m.agent ol{margin:6px 0}
.srk-m.agent>:first-child{margin-top:0} .srk-m.agent>:last-child{margin-bottom:0}
.srk-m.agent ul,.srk-m.agent ol{padding-left:18px}
.srk-m.agent ul{list-style:disc}
.srk-m.agent ol{list-style:decimal}
.srk-m.agent a{color:var(--a)}
.srk-m.agent h1,.srk-m.agent h2,.srk-m.agent h3,.srk-m.agent h4{margin:10px 0 4px;font:600 1em/1.3 var(--sans)}
.srk-m.agent code{font:12px var(--mono);background:rgba(120,70,30,.09);border-radius:5px;padding:1px 4px}
.srk-m.agent pre{overflow:auto;max-height:360px;padding:8px 10px;border-radius:9px;background:#22130a;color:#ffe9d2}
.srk-m.agent pre code{background:none;padding:0;color:inherit}
.srk-m.agent table{border-collapse:collapse;font-size:12.5px;display:block;overflow:auto}
.srk-m.agent td,.srk-m.agent th{border:1px solid rgba(60,30,10,.16);padding:2px 6px}
.srk-m.agent.mid{color:#5b4230;font-size:.94em}
.srk-m.agent.final{color:#22130a}
.srk-m.you.out{opacity:.7}
.srk-who b{font-weight:500;letter-spacing:.12em}
.srk-tmeta{font:10.5px var(--mono);color:#a08268}
.srk-older{align-self:center}
.srk-fail{display:grid;gap:4px;padding:9px 12px;border-radius:12px;background:#fdf0eb;border:1px solid color-mix(in srgb,#a3361a 28%,transparent);color:#7a2a14;font-size:13px}
.srk-fail b{font-weight:600}
.srk-fail.limit{background:color-mix(in srgb,var(--a) 8%,#fff);border-color:color-mix(in srgb,var(--a) 30%,transparent);color:#4a2a14}
.srk-notice{margin:0;font-size:12.5px;color:#8a5a10}
.srk-notice.error{color:#a3361a}

/* Steps of the work: one tight group per run of them. */
.srk-steps{display:grid;grid-template-columns:minmax(0,1fr);border-radius:12px;border:1px solid rgba(60,30,10,.1);background:rgba(255,255,255,.55);overflow:hidden}
.srp .srk-stepsum{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;background:none;color:#6a4a32;font:500 12px var(--sans);text-align:left;cursor:pointer}
.srk-stepsum:hover{color:#22130a;background:rgba(255,255,255,.7)}
.srk-stepsum i{font-style:normal;font-size:10px;transition:transform .15s ease}
.srk-stepsum[aria-expanded=true] i{transform:rotate(90deg)}
.srk-stepsum[aria-expanded=true]{border-bottom:1px solid rgba(60,30,10,.08)}
.srk-step+.srk-step{border-top:1px solid rgba(60,30,10,.07)}
.srp .srk-sline{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:5px 10px;border:0;background:none;color:#22130a;font:12.5px/1.4 var(--sans);text-align:left;cursor:pointer}
.srp .srk-sline:hover{background:rgba(255,255,255,.8)}
.srp .srk-sline:disabled{cursor:default;background:none}
.srk-sline[aria-expanded=true]{background:rgba(255,255,255,.85)}
.srk-tag{flex:none;width:38px;text-align:center;font:500 8.5px/16px var(--mono);letter-spacing:.08em;text-transform:uppercase;border-radius:999px;background:rgba(34,19,10,.07);color:#6a4a32}
.srk-step.failed .srk-tag{background:#fbe6df;color:#a3361a}
.srk-step.running .srk-tag{background:color-mix(in srgb,var(--a) 14%,#fff);color:var(--a)}
.srk-sline code{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px var(--mono);color:#22130a}
.srk-sline .txt{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#5b4230}
.srk-sline .txt.think{font-style:italic;color:#8a6a52}
.srk-sline .sub{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11.5px var(--mono);color:#a08268}
.srk-sline .sp{flex:1 1 0;min-width:4px}
.srk-sline .st{flex:none;font:500 10.5px var(--mono);color:#1f7a4a}
.srk-sline .st.failed{color:#a3361a}
.srk-sline .st.declined{color:#8a6a52}
.srk-sline .st.running{width:8px;height:8px;border-radius:50%;background:var(--a);animation:srp-pulse 1.2s ease-in-out infinite}
.srk-sline .dur{flex:none;font:10.5px var(--mono);color:#a08268}
.srk-sline .add{flex:none;font:500 11px var(--mono);color:#1f7a4a}
.srk-sline .del{flex:none;font:500 11px var(--mono);color:#a3361a}
.srk-open{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:2px 10px 10px 56px}
.srk-open .k{font:500 9px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#a08268}
.srk-out{margin:0;max-height:300px;overflow:auto;padding:8px 10px;border-radius:9px;background:#22130a;color:#ffe9d2;font:11.5px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;overscroll-behavior:contain}
.srk-out.empty{background:rgba(34,19,10,.06);color:#8a6a52;font-style:italic}
.srk-open .think{margin:0;white-space:pre-wrap;font-size:12.5px;font-style:italic;color:#6a4a32}
.srk-open .cwd{font:10.5px var(--mono);color:#8a6a52;overflow-wrap:anywhere}

/* A file's diff, its lines numbered, what was added green and what was taken out red. */
.srk-diff{max-height:420px;overflow:auto;border-radius:9px;border:1px solid rgba(60,30,10,.12);background:#fff;font:11.5px/1.5 var(--mono);overscroll-behavior:contain}
.srk-diff .dl{display:grid;grid-template-columns:3.4em 3.4em minmax(max-content,1fr);min-width:100%;width:max-content}
.srk-diff .n{padding:0 6px;text-align:right;color:#b39a84;user-select:none;border-right:1px solid rgba(60,30,10,.06)}
.srk-diff .c{padding:0 10px 0 6px;white-space:pre;color:#3a2412}
.srk-diff .dl.add{background:#e9f6ec}
.srk-diff .dl.add .c{color:#195a32}
.srk-diff .dl.add .n{background:#d8efdd;color:#4c8a5f}
.srk-diff .dl.del{background:#fcebe6}
.srk-diff .dl.del .c{color:#8a2c1b}
.srk-diff .dl.del .n{background:#f7dad1;color:#b0634e}
.srk-diff .dl.hunk{background:color-mix(in srgb,var(--sky) 40%,#fff)}
.srk-diff .dl.hunk .c,.srk-diff .dl.meta .c{color:#6a6a8a}
.srk-diff .dl.meta{color:#8a6a52}
.srk-diff .more{padding:4px 10px;font:11px var(--sans);color:#8a6a52;background:rgba(34,19,10,.04)}

/* The agent's plan, ticked off in place. */
.srk-plan{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in srgb,var(--a) 22%,transparent);background:color-mix(in srgb,var(--a) 5%,#fff)}
.srk-plan .h{display:flex;align-items:baseline;gap:8px}
.srk-plan .h small{font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.srk-plan .h span{font:10.5px var(--mono);color:#8a6a52}
.srk-plan ol{list-style:none;margin:0;padding:0;display:grid;gap:3px}
.srk-plan li{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.4;color:#22130a}
.srk-plan li i{flex:none;width:13px;height:13px;margin-top:3px;border-radius:50%;border:1.5px solid rgba(60,30,10,.35);box-sizing:border-box}
.srk-plan li.running i{border-color:var(--a);background:radial-gradient(circle,var(--a) 0 3px,transparent 3.5px);animation:srp-pulse 1.4s ease-in-out infinite}
.srk-plan li.done{color:#8a6a52;text-decoration:line-through;text-decoration-color:rgba(60,30,10,.3)}
.srk-plan li.done i{border-color:#1f7a4a;background:#1f7a4a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='9' viewBox='0 0 9 9'%3E%3Cpath d='M1.5 4.6l2 2 4-4.4' fill='none' stroke='white' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center}
.srk-plan p{margin:0;font-size:12.5px;color:#6a4a32}

/* What the agent asks: pinned above the composer while it waits. */
.srk-asks{flex:none;max-height:42%;overflow:auto;overscroll-behavior:contain;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:10px 12px;border-top:1px solid color-mix(in srgb,var(--a) 22%,transparent);background:color-mix(in srgb,var(--a) 6%,#fff)}
.srk-ask{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:10px 12px;border-radius:14px;background:#fff;border:1px solid color-mix(in srgb,var(--a) 35%,transparent);box-shadow:0 10px 24px -20px rgba(120,60,10,.7)}
.srk-ask .h{display:flex;align-items:center;gap:8px}
.srk-ask .h i{flex:none;width:8px;height:8px;border-radius:50%;background:var(--a);animation:srp-pulse 1.4s ease-in-out infinite}
.srk-ask .h b{font:600 13px var(--sans)}
.srk-ask .h small{margin-left:auto;font:500 9px var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:rgba(34,19,10,.07);color:#6a4a32}
.srk-ask .t{margin:0;font:500 13.5px/1.4 var(--sans);overflow-wrap:anywhere}
.srk-ask .d{margin:0;font-size:12.5px;color:#5b4230;white-space:pre-wrap;overflow-wrap:anywhere}
.srk-ask .srk-out{max-height:140px}
.srk-ask .cwd{font:10.5px var(--mono);color:#8a6a52;overflow-wrap:anywhere}
.srk-askmore{margin:0;font:500 11.5px var(--sans);color:#8a6a52;text-align:center}
.srk-ask .srk-steps{background:#fffdfa}
.srk-ask .acts{display:flex;flex-wrap:wrap;gap:6px}
.srp .srk-ask .acts button{height:32px;padding:0 14px;border-radius:999px;border:1px solid rgba(60,30,10,.2);background:#fff;color:#22130a;font:500 12.5px var(--sans);cursor:pointer}
.srp .srk-ask .acts button:hover:not(:disabled){border-color:var(--a)}
.srp .srk-ask .acts button.yes{border-color:#120a05;background:linear-gradient(180deg,#4a3526,#22130a 55%,#170c06);color:#fff6ec;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 2px 0 #0c0603}
.srp .srk-ask .acts button.no{color:#a3361a}
.srp .srk-ask .acts button.quiet{border-color:transparent;background:none;color:#8a6a52;padding:0 6px;text-decoration:underline;text-underline-offset:3px}
.srp .srk-ask .acts button.quiet:hover:not(:disabled){color:#a3361a;border-color:transparent}
.srp .srk-ask .acts button:disabled{opacity:.5;cursor:default}
.srk-ask .else{margin:0;font-size:12.5px;color:#6a4a32}

/* The composer of a session: Stop while it works, and what is sent then steers the turn. */
.srk-steer{margin:0;display:flex;align-items:center;gap:8px;font-size:12.5px;color:#5b4230}
.srk-steer i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--a);animation:srp-pulse 1.4s ease-in-out infinite}
.srp .srk-stop{flex:none;height:38px;padding:0 14px;border-radius:999px;border:1px solid rgba(60,30,10,.25);background:#fff;color:#22130a;font:600 13px var(--sans);cursor:pointer}
.srp .srk-stop:hover:not(:disabled){border-color:#a3361a;color:#a3361a}
.srp .srk-stop:disabled{opacity:.55;cursor:default}
.srp .srk-stop .sq{display:inline-block;width:9px;height:9px;margin-right:7px;border-radius:2px;background:currentColor;vertical-align:-0.5px}
.srk-limit{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:10.5px var(--mono);color:#8a6a52}
.srk-limit.full{color:#a3361a}
.srk-fullask{flex:1 0 100%;order:9;display:grid;gap:7px;padding:9px 11px;border-radius:12px;background:#fdf0eb;border:1px solid color-mix(in srgb,#a3361a 40%,transparent);font:12.5px/1.45 var(--sans);color:#5b2a1a;white-space:normal}
.srk-on:has(.srk-fullask){flex-wrap:wrap;row-gap:7px}
.srk-fullask p{margin:0}
.srk-fullask b{color:#8a2c1b}
.srp .srk-fullask .danger{color:#a3361a;border-color:color-mix(in srgb,#a3361a 35%,transparent);background:#fff}
.srk-fullask .row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.srp .srk-model.risky{border-color:color-mix(in srgb,#a3361a 55%,transparent);background-color:#fdf0eb;color:#8a2c1b}
.srp .srk-jump{position:absolute;left:50%;transform:translateX(-50%);z-index:2;height:30px;padding:0 13px;border-radius:999px;border:1px solid rgba(60,30,10,.18);background:#fff;color:#22130a;font:500 12px var(--sans);cursor:pointer;box-shadow:0 8px 20px -12px rgba(60,30,10,.6)}
.srk-logwrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.srk-logwrap>.srk-log{flex:1}
.srk-logwrap>.srk-jump{bottom:10px}

/* A wide screen: read like a page, as the OpenClaw chats are. */
.wide .srk-clog{gap:14px}
.wide .srk-m.agent p,.wide .srk-m.agent ul,.wide .srk-m.agent ol{margin:8px 0}
.wide .srk-m.agent code{font-size:12.5px}
.wide .srk-new{padding:2px 16px 18px}
.wide .srk-asks{padding:12px 14px;margin:0}

/* A phone: what is typed in is 16px, what is pressed a finger wide. */
.cols-1 .srk-agents{grid-template-columns:minmax(0,1fr)}
.srp.cols-1 .srk-agent{padding:12px 14px}
.srp.cols-1 .srk-place{height:44px;font-size:16px}
.srp.cols-1 .srk-sline{min-height:40px;padding:8px 12px}
.cols-1 .srk-open{padding:2px 12px 12px}
.srp.cols-1 .srk-stepsum{min-height:40px;padding:8px 12px}
.srp.cols-1 .srk-ask .acts button{height:44px;padding:0 16px;font-size:14.5px}
.srp.cols-1 .srk-stop{height:44px}
.srp.cols-1 .srk-more{width:44px;height:40px;margin:-8px -10px -8px 0}
.srp.cols-1 .srk-linkish{padding:10px 0;margin:-10px 0}
.cols-1 .srk-menu input{height:44px;font-size:16px}
.cols-1 .srk-signin .paste input{height:44px;font-size:16px}
.srp.cols-1 .srk-signin .srp-chip{min-height:40px}
.srp.cols-1 .srk-menu .srp-chip{min-height:40px}
.cols-1 .srk-diff,.cols-1 .srk-out{font-size:11px}
.srk-cpicks{flex-wrap:wrap;justify-content:flex-end;row-gap:6px}
.cols-1 .srk-cpicks{margin-left:0;justify-content:flex-start}
/* A phone's session composer: model, effort and mode side by side (each cut short), not three rows over the log. */
.srp.cols-1 .srk-foot .srk-cpicks{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);width:100%}
.srp.cols-1 .srk-foot .srk-cpicks .srk-model{width:100%;padding:0 22px 0 10px}
.cols-1 .srk-diff .dl{grid-template-columns:2.8em 2.8em minmax(max-content,1fr)}
`;
