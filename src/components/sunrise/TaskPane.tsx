'use client';

// What a task opens to in Sunrise: its workspace, most of the screen, in three parts.
// - Left, the brief: OpenClaw speaks first (what to do now and why it is easy, what it already did), then the facts
//   of the task in one strip, what OpenClaw wants him to know, and everything else the Journal knows, folded. Done
//   and Let go sit at its foot. It folds away.
// - Middle, the surfaces, one tab each. "Work" is what OpenClaw started, each block drawn as the thing it is (a
//   letter on paper, a slide lit on a stage, a page with a margin, a list to tick), saving itself as he works; with
//   nothing started it offers to have OpenClaw start it, or to start it himself. Every real link the task has is a
//   web tab, shown live in OpenClaw's own browser (BrowserSurface); he can paste an address for another.
// - Right, his chats with OpenClaw about the task (WorkspaceChats). Folded away, their composer stays in one line
//   under the surface.
// On a phone it is one column: the tabs across the top, the brief behind a toggle, the chats as a sheet under the
// surface. Nothing here is invented: a task with no links has no web tabs and a task with no chats has none.
// The engine grows the pane out of the task's form; this fills it.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getCurrentDateISO } from '@/lib/current-date';
import type { BriefAction, BriefRelated, TaskBrief } from '@/lib/task-brief';
import type { ResolvedWork } from '@/lib/hook-work';
import type { IconName, Part } from '@/lib/shapes/catalog';
import { isActive, type WorkBlock } from '@/lib/shapes/work';
import { iconOf, renderPart } from '@/lib/shapes/render';
import type { SunriseData } from '@/lib/sunrise/data';
import { confirmText, runBriefAction } from '@/components/horizon/brief-actions';
import type { ChatSurfaceRef } from '@/lib/task-chat';
import { defaultSurfaceId, deriveSurfaces, pageKey, safeWebUrl, surfaceId, type Surface } from '@/lib/task-surfaces';
import { BROWSER_SURFACE_CSS, BrowserSurface, type OpenedTab } from './BrowserSurface';
import { CHATS_CSS, ChatsPanel, MiniChat, useTaskChats } from './WorkspaceChats';

const BRIEF_AND_WORK_CSS = `
/* Daylight, tinted by what the task is: a low sun in its colour, sky above it, and the work on top. */
.srp{--a:#c2551b;--glow:#ffc98a;--sky:#cfe4ff;--a-soft:color-mix(in srgb,var(--a) 14%,transparent);
  position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);overflow:hidden;color:#22130a;font:14px/1.5 var(--sans);isolation:isolate;
  background:radial-gradient(90% 70% at 14% 112%,var(--glow) 0%,color-mix(in srgb,var(--glow) 55%,transparent) 34%,transparent 62%),radial-gradient(70% 60% at 96% -8%,var(--sky) 0%,color-mix(in srgb,var(--sky) 50%,transparent) 40%,transparent 70%),linear-gradient(180deg,#fbfcff 0%,#fffaf5 55%,#fff4e8 100%)}
.srp::before{content:"";position:absolute;z-index:-1;left:-10%;bottom:-34%;width:60%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--a) 42%,transparent),transparent 68%);filter:blur(14px);pointer-events:none;animation:srp-drift 16s ease-in-out infinite alternate}
.srp::after{content:"";position:absolute;z-index:-1;right:-14%;top:-30%;width:48%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--sky) 80%,transparent),transparent 66%);filter:blur(18px);pointer-events:none;animation:srp-drift 21s ease-in-out infinite alternate-reverse}
.srp-glass{background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.46));backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);border:1px solid rgba(255,255,255,.95);border-radius:20px;
  box-shadow:inset 0 1px 0 #fff,inset 0 -1px 0 rgba(255,255,255,.4),0 18px 44px -26px rgba(120,60,10,.55),0 2px 6px -3px rgba(120,60,10,.18)}

/* The bar: what it is and when, quietly, and the ways out. */
.srp-bar{display:flex;align-items:center;gap:12px;padding:14px 16px 4px 22px}
.srp-eyebrow{flex:1;min-width:0;overflow:hidden;display:flex;align-items:center;gap:8px;font:500 10.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--a);white-space:nowrap}
.srp-eyebrow .icon{flex:none;width:15px;height:15px;color:var(--a)}
.srp-name{flex:1 1 0;min-width:60px;overflow:hidden;text-overflow:ellipsis;letter-spacing:0;text-transform:none;font:500 13px var(--sans);color:#5b4230}
.srp-due{flex:none;letter-spacing:.04em;text-transform:none;font:500 11.5px var(--mono);padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.7);border:1px solid color-mix(in srgb,var(--a) 28%,transparent);color:#4a2a14}
.srp-due.soon{background:var(--a);border-color:var(--a);color:#fff}
.srp-due.over{background:#22130a;border-color:#22130a;color:#ffd9b8}
.srp-where{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;letter-spacing:.02em;text-transform:none;font:12px var(--sans);color:#6a4a32}
.srp-acts{flex:none;display:flex;gap:8px;align-items:center}
.srp-acts button{border:1px solid rgba(60,30,10,.16);background:rgba(255,255,255,.6);border-radius:999px;padding:7px 15px;font:500 13px var(--sans);cursor:pointer;color:#22130a;transition:transform .15s ease,border-color .15s ease,background .15s ease}
.srp-acts button:hover{border-color:var(--a);background:#fff;transform:translateY(-1px)}
.srp-acts button:disabled{opacity:.5;cursor:default;transform:none}
.srp-acts .doneb{background:#22130a;color:#fff6ec;border-color:#22130a;box-shadow:0 8px 18px -10px rgba(34,19,10,.8)}
.srp-acts .doneb:hover{background:#3a2112;border-color:#3a2112}
.srp-acts .x{width:36px;height:36px;padding:0;display:grid;place-items:center;font-size:15px}

/* One column that scrolls: OpenClaw speaks, then the work, then the rest. */
.srp-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;padding:10px 26px 104px}
.srp-col{max-width:760px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
.scene-deck .srp-col,.scene-pick .srp-col,.srp.desk .srp-col{max-width:900px}
.scene-letter:not(.desk) .srp-col,.scene-verdict .srp-col{max-width:680px}

/* OpenClaw speaks first. */
.srp-say{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 18px;align-items:start;padding-top:10px}
.srp-orb{width:32px;height:32px;margin-top:20px;border-radius:50%;background:radial-gradient(circle at 34% 30%,#fff,var(--glow) 46%,var(--a) 100%);box-shadow:0 0 0 6px var(--a-soft),0 0 30px 6px color-mix(in srgb,var(--a) 38%,transparent);animation:srp-breathe 4.4s ease-in-out infinite}
.srp-orb.busy{animation-duration:1.1s}
.srp-who{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font:500 10.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--a)}
.srp-who em{font-style:normal;letter-spacing:.02em;text-transform:none;color:#8a6a52}
.srp-who button{border:0;background:none;padding:0;cursor:pointer;font:500 11px var(--sans);letter-spacing:0;text-transform:none;color:var(--a);text-decoration:underline;text-underline-offset:3px}
.srp-say h2{margin:4px 0 0;font:400 clamp(27px,3vw,38px)/1.06 var(--serif);letter-spacing:-.008em;text-wrap:balance;animation:srp-up .55s .05s both}
.srp-say .why{margin:8px 0 0;max-width:60ch;font:400 16px/1.45 var(--sans);color:#4a3424;animation:srp-up .55s .16s both}
.srp-trail{display:flex;flex-wrap:wrap;gap:6px 8px;margin:14px 0 0;padding:0;list-style:none}
.srp-trail li{font:12.5px var(--sans);color:#3d2a1c;padding:3px 11px 3px 8px;border-radius:999px;background:rgba(255,255,255,.66);border:1px solid rgba(255,255,255,.95);box-shadow:0 1px 2px rgba(120,60,10,.08);animation:srp-pop .45s both}
.srp-trail li::before{content:"✓";color:#1f8a52;font-weight:700;margin-right:6px}
.srp-doors{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px;animation:srp-up .5s .5s both}
.srp .srp-door{display:inline-flex;align-items:baseline;gap:8px;padding:9px 17px;border-radius:999px;border:0;background:#22130a;color:#fff6ec;font:500 14px var(--sans);text-decoration:none;cursor:pointer;box-shadow:0 10px 22px -12px rgba(34,19,10,.8);transition:transform .15s ease}
.srp-door:hover{transform:translateY(-1px)}
.srp-door span{color:var(--glow)}
.srp-links{display:contents}
.srp-links a{display:inline-flex;align-items:baseline;gap:6px;max-width:260px;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.7);border:1px solid rgba(60,30,10,.14);color:#22130a;text-decoration:none;font-size:12.5px}
.srp-links a:hover{border-color:var(--a);background:#fff}
.srp-links a small{font:9.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--a)}
.srp-links a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srp-when{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:14px;font:13px var(--sans);color:#6a4426}
.srp-chip{border:1px solid rgba(60,30,10,.18);background:rgba(255,255,255,.7);border-radius:999px;padding:4px 12px;font:500 12.5px var(--sans);cursor:pointer;color:#22130a}
.srp-chip:hover{border-color:var(--a);background:#fff}
.srp-chip:disabled{opacity:.5;cursor:default}
.srp-when input{border:1px solid rgba(60,30,10,.18);border-radius:999px;background:rgba(255,255,255,.8);color:#22130a;height:28px;padding:0 10px;font:12px var(--sans)}
.srp-err{margin:8px 0 0;color:#a3361a;font-size:12.5px}

/* What OpenClaw wants him to know before he starts: said, not boxed. */
.srp-asides{display:grid;gap:8px;animation:srp-up .5s .4s both}
.srp-flag{padding:1px 0 1px 14px;border-left:2px solid rgba(60,30,10,.16);font-size:14px;color:#5b4230}
.srp-flag.warn{border-left-color:var(--a);border-left-width:3px;color:#2e1808;font-weight:500}
.srp-flag.gap{border-left-style:dashed}
.srp-act{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:7px;font-size:12.5px;font-weight:400}
.srp-act pre{flex:1 1 100%;margin:0;padding:7px 9px;border-radius:9px;background:rgba(255,255,255,.7);white-space:pre-wrap;max-height:120px;overflow:auto;font:12px/1.4 var(--sans)}
.srp-act .ok{color:#1f7a4a;font-weight:500}
.srp-act .err{color:#a3361a}
.srp-oc{margin-left:6px;font:9.5px var(--mono);font-weight:400;letter-spacing:.04em;color:#a08268;white-space:nowrap}

/* The facts of it, large, in one strip; and the stages to it as a path. */
.srp-ribbon{display:flex;flex-wrap:wrap;gap:12px 0;padding:14px 0;border-top:1px solid rgba(60,30,10,.12);border-bottom:1px solid rgba(60,30,10,.12);animation:srp-up .5s .3s both}
.srp-ribbon div{flex:1 1 140px;min-width:0;padding:0 18px;border-left:1px solid rgba(60,30,10,.1)}
.srp-ribbon div:first-child{padding-left:0;border-left:0}
.srp-ribbon b{display:block;font:400 20px/1.2 var(--serif);color:#22130a;overflow-wrap:anywhere}
.srp-ribbon span{display:block;margin-top:3px;font:500 9.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--a)}
.srp-path{display:flex;align-items:flex-start;margin:0;padding:4px 0 0;list-style:none;animation:srp-up .5s .3s both}
.srp-path li{flex:1;min-width:0;position:relative;padding:22px 6px 0;text-align:center;font:500 13px/1.25 var(--sans);color:#7a5a42}
.srp-path li::before{content:"";position:absolute;z-index:1;top:3px;left:50%;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:#fff;border:2px solid rgba(60,30,10,.3);box-sizing:border-box}
.srp-path li::after{content:"";position:absolute;top:8px;right:50%;width:100%;height:2px;background:rgba(60,30,10,.14)}
.srp-path li:first-child::after{display:none}
.srp-path li.did{color:#5b4230}
.srp-path li.did::before{background:#1f8a52;border-color:#1f8a52}
.srp-path li.did::after,.srp-path li.now::after{background:var(--a)}
.srp-path li.now{color:#22130a;font-weight:600}
.srp-path li.now::before{background:var(--a);border-color:var(--a);box-shadow:0 0 0 5px var(--a-soft);animation:srp-pulse 2.2s ease-in-out infinite}
.srp-path li small{display:block;margin-top:2px;font:11px var(--mono);font-weight:400;color:#8a6a52}
.srp-parts{--fg:#22130a;--sub:rgba(34,19,10,.62);--accent:var(--a);--line:rgba(60,30,10,.16);--fill:#fff;--soft:rgba(34,19,10,.08);--hot:#d2451a;--good:#1f7a4a;--good-soft:rgba(31,122,74,.13);display:grid;gap:12px;color:var(--fg);font-size:14px;animation:srp-up .5s .34s both}
.srp-parts .p-quote{font-size:21px;line-height:1.3}
.srp-parts .p-value b{font-size:40px}
.srp-parts .p-line{font-size:15px}

/* The work. Each block is an object he already knows how to use: a mail draft, a notes page, a list of
   reminders, a slide presenter, a form, a book. Its title bar says what it is and how it stands. */
.srp-work{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start;animation:srp-rise .65s .28s both}
.srp-work.desk{grid-template-columns:minmax(0,1.75fr) minmax(0,1fr)}
.srp-work.desk.listfirst{grid-template-columns:minmax(0,1fr) minmax(0,1.75fr)}
.srp-work.desk>.srp-jumprow,.srp-work.desk>.srp-foot{grid-column:1/-1}
.srp-jumprow{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.srp .srp-jump{display:inline-flex;align-items:center;gap:10px;max-width:100%;padding:9px 18px 9px 12px;border-radius:999px;cursor:pointer;text-align:left;color:#fff;font:600 14.5px var(--sans);border:1px solid color-mix(in srgb,var(--a) 70%,#000);
  background:linear-gradient(180deg,color-mix(in srgb,var(--a) 78%,#fff) 0%,var(--a) 52%,color-mix(in srgb,var(--a) 88%,#000) 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(0,0,0,.18),0 2px 0 color-mix(in srgb,var(--a) 60%,#000),0 12px 22px -12px color-mix(in srgb,var(--a) 90%,#000);transition:transform .08s ease,box-shadow .08s ease}
.srp-jump:hover{filter:brightness(1.06)}
.srp-jump:active{transform:translateY(2px);box-shadow:inset 0 2px 4px rgba(0,0,0,.3),0 0 0 color-mix(in srgb,var(--a) 60%,#000)}
.srp-jump .play{flex:none;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.95);color:var(--a);display:grid;place-items:center;font-size:10px;padding-left:2px;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.srp-jump span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srp-jumprow a,.srp-under a{color:var(--a);text-decoration:none;font:500 12.5px var(--sans);white-space:nowrap}
.srp-jumprow a:hover,.srp-under a:hover{text-decoration:underline}
.srp-lab{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.srp-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font:12px var(--sans);color:#7a5a42}

/* A window: the object's frame. The bar names it and shows its state; nothing on it is for show. */
.srp-win{min-width:0;border-radius:13px;overflow:hidden;background:#fff;border:1px solid rgba(40,22,10,.2);box-shadow:inset 0 1px 0 #fff,0 34px 60px -34px rgba(40,22,10,.6),0 4px 10px -3px rgba(40,22,10,.16)}
.srp-title{display:flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border-bottom:1px solid rgba(40,22,10,.14);background:linear-gradient(180deg,#fbf9f6,#ece6de);box-shadow:inset 0 1px 0 #fff;font:600 12.5px var(--sans);color:#3a2616}
.srp-title .icon{flex:none;width:15px;height:15px;color:var(--a)}
.srp-title b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.srp-title .r{margin-left:auto;flex:none;display:flex;align-items:center;gap:8px;font:500 11px var(--mono);color:#8a6a52;white-space:nowrap}
.srp-title .r .led{width:7px;height:7px;border-radius:50%;background:#2aa860;box-shadow:0 0 0 2px rgba(42,168,96,.2)}
.srp-title .r .led.busy{background:#e0a020;box-shadow:0 0 0 2px rgba(224,160,32,.25);animation:srp-pulse 1s ease-in-out infinite}
.srp-title .r .led.bad{background:#d2451a;box-shadow:0 0 0 2px rgba(210,69,26,.2)}
.srp-body{padding:16px 20px 18px}
.srp-under{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 14px;border-top:1px solid rgba(40,22,10,.1);background:linear-gradient(180deg,#f8f5f1,#f0ebe4);font:12px var(--sans);color:#7a5a42}
.srp-under .sp{margin-left:auto}
/* Notes: a yellow bar, warm paper, a margin line. */
.win-notes .srp-title{background:linear-gradient(180deg,#ffeaa6,#ffd766);border-bottom-color:rgba(120,90,0,.25)}
.win-notes .srp-title .icon{color:#8a6500}
.win-notes{background:#fffdf2}
.win-notes .srp-body{padding:20px 26px 24px 54px;background:linear-gradient(90deg,transparent 37px,rgba(214,90,70,.38) 37px,rgba(214,90,70,.38) 38.5px,transparent 38.5px)}
/* Reminders: a clean list, one row per thing, and a pip for each. */
.win-list .srp-body{padding:6px 8px 8px}
.srp-pips{display:flex;gap:4px;align-items:center}
.srp-pips i{width:9px;height:9px;border-radius:50%;background:rgba(40,22,10,.08);box-shadow:inset 0 1px 2px rgba(40,22,10,.28);transition:background .25s ease}
.srp-pips i.on{background:radial-gradient(circle at 35% 30%,#8ff0b6,#1f9a58);box-shadow:inset 0 -1px 1px rgba(0,0,0,.2),0 0 0 1px rgba(31,138,82,.35)}
.win-list .srp-line{padding:9px 10px;margin:0;border-radius:9px}
.win-list .srp-line+.srp-line{box-shadow:0 -1px 0 rgba(40,22,10,.07)}
.win-list .srp-line textarea,.win-list .srp-line .shown{font-size:15px;line-height:1.45}
/* Mail: who, about what, the words, and that it has gone nowhere yet. */
.win-mail .srp-title{background:linear-gradient(180deg,#f4f8ff,#dfe9fb)}
.win-mail .srp-title .r{color:var(--a);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.srp-letter label{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:baseline;padding:8px 20px;border-bottom:1px solid rgba(40,22,10,.09);font:12px var(--sans);color:#8a6a52}
.srp-letter label input,.srp-slides .ttl{width:100%;border:0;outline:0;background:transparent;color:#22130a;font:14.5px var(--sans);padding:2px 0}
.srp-letter .srp-body{padding:20px 26px 22px}
.srp-letter .srp-line textarea,.srp-letter .srp-line .shown{font:400 17px/1.6 var(--serif)}
/* A problem on squared paper. */
.win-problem .srp-body{background:linear-gradient(rgba(60,110,190,.08) 1px,transparent 1px) 0 0/100% 24px,linear-gradient(90deg,rgba(60,110,190,.08) 1px,transparent 1px) 0 0/24px 100%,#fdfefe}
.srp-problem .prompt{margin:0 0 10px;font:400 22px/1.3 var(--serif);color:#22130a;white-space:pre-wrap}
.srp-problem pre{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#22130a;color:#ffe9d2;font:12.5px/1.55 var(--mono);overflow:auto;white-space:pre}
.srp-problem .srp-line textarea,.srp-problem .srp-line .shown{font:15px/1.6 var(--mono)}
/* A form: labels on the left, wells to type in, and a mark on what only he can answer. */
.win-form{background:#f4f1ec}
.srp-fields label{display:grid;grid-template-columns:minmax(110px,32%) minmax(0,1fr);gap:4px 14px;align-items:center;padding:6px 0;font:13px var(--sans);color:#5b4230}
.srp-fields label>span{text-align:right}
.srp-fields input{width:100%;border:1px solid rgba(40,22,10,.22);border-radius:7px;outline:0;padding:7px 10px;background:#fff;color:#22130a;font:14.5px var(--sans);box-shadow:inset 0 1px 2px rgba(40,22,10,.14)}
.srp-fields input:focus{border-color:var(--a);box-shadow:inset 0 1px 2px rgba(40,22,10,.14),0 0 0 3px color-mix(in srgb,var(--a) 28%,transparent)}
.srp-fields label.needs input{border-color:var(--a);background:color-mix(in srgb,var(--a) 6%,#fff)}
.srp-fields label i{grid-column:2;font:500 11px var(--sans);font-style:normal;color:var(--a)}
/* A choice: big tiles that press in, one at a time. */
.srp-choices .prompt{margin:0 0 10px 2px;font:400 22px/1.25 var(--serif)}
.srp-choices .opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.srp-choices .opts button{position:relative;display:flex;flex-direction:column;gap:6px;text-align:left;padding:16px 16px 14px 44px;cursor:pointer;color:#22130a;font:13px/1.4 var(--sans);border-radius:14px;border:1px solid rgba(40,22,10,.2);background:linear-gradient(180deg,#fff,#f4efe9);box-shadow:inset 0 1px 0 #fff,0 3px 0 rgba(40,22,10,.14),0 14px 24px -16px rgba(40,22,10,.5);transition:transform .08s ease,box-shadow .08s ease}
.srp-choices .opts button::before{content:"";position:absolute;left:14px;top:18px;width:18px;height:18px;border-radius:50%;background:#fff;border:1.5px solid rgba(40,22,10,.35);box-shadow:inset 0 1px 2px rgba(40,22,10,.2);box-sizing:border-box}
.srp-choices .opts button:hover{transform:translateY(-1px)}
.srp-choices .opts button:active,.srp-choices .opts button.on{transform:translateY(3px);box-shadow:inset 0 2px 5px rgba(40,22,10,.18),0 0 0 2px var(--a)}
.srp-choices .opts button.on{background:color-mix(in srgb,var(--a) 7%,#fff)}
.srp-choices .opts button.on::before{border-color:var(--a);background:radial-gradient(circle,var(--a) 0 42%,#fff 46%)}
.srp-choices .opts b{font:400 21px/1.15 var(--serif)}
.srp-choices .opts span{color:#5b4230}
.srp-choices .opts ul{margin:0;padding-left:16px;color:#5b4230;font-size:12.5px}
/* A presenter: the slides down the side, the one being worked on lit, and what he will say under it. */
.win-deck{background:#231a2b;border-color:#120c18}
.win-deck .srp-title{background:linear-gradient(180deg,#4a3b58,#32263f);border-bottom-color:#120c18;box-shadow:inset 0 1px 0 rgba(255,255,255,.18);color:#f1e8ff}
.win-deck .srp-title .icon{color:var(--glow)}
.win-deck .srp-title .r{color:rgba(255,255,255,.6)}
.srp-slides{display:grid;grid-template-columns:150px minmax(0,1fr)}
.srp-slides .strip{display:flex;flex-direction:column;gap:10px;padding:14px 12px;background:rgba(0,0,0,.28);border-right:1px solid rgba(0,0,0,.4);overflow:auto}
.srp-slides .strip button{position:relative;aspect-ratio:16/9;display:flex;align-items:flex-end;text-align:left;padding:6px 7px;margin-left:16px;border-radius:4px;border:2px solid transparent;background:#fffefb;cursor:pointer;color:#3d2a1c;font:500 9.5px/1.2 var(--sans);box-shadow:0 2px 6px rgba(0,0,0,.5)}
.srp-slides .strip button small{position:absolute;left:-18px;top:2px;font:10px var(--mono);color:rgba(255,255,255,.6)}
.srp-slides .strip button span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.srp-slides .strip button.on{border-color:var(--glow);box-shadow:0 0 0 2px color-mix(in srgb,var(--a) 70%,transparent),0 2px 8px rgba(0,0,0,.5)}
.srp-slides .strip button.on small{color:var(--glow)}
.srp-slides .stage{min-width:0;padding:22px 26px 16px}
.srp-slides .slide{aspect-ratio:16/9;display:flex;flex-direction:column;gap:8px;overflow:auto;padding:24px 28px;border-radius:5px;background:#fffefb;box-shadow:0 0 0 1px rgba(255,255,255,.15),0 0 60px 4px color-mix(in srgb,var(--glow) 40%,transparent)}
.srp-slides .ttl{font:400 28px/1.12 var(--serif);padding:0}
.srp-slides .slide .srp-doc{flex:1}
.srp-slides .notes{display:grid;gap:4px;margin-top:14px;font:500 9.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.55)}
.srp-slides .notes textarea{resize:vertical;border:0;outline:0;background:transparent;color:rgba(255,255,255,.9);font:14px/1.5 var(--sans);letter-spacing:0;text-transform:none}
.srp-slides .notes textarea::placeholder{color:rgba(255,255,255,.35)}
/* A timer: the time left, big, and its steps. */
.srp-timer{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 18px;align-items:center}
.srp-timer .face{grid-row:1/3;width:140px;height:140px;border-radius:50%;display:grid;place-content:center;justify-items:center;background:radial-gradient(circle at 36% 28%,#fff,#f1ece6 70%);border:6px solid #3a2616;box-shadow:inset 0 2px 6px rgba(40,22,10,.3),0 10px 20px -10px rgba(40,22,10,.6)}
.srp-timer .face b{font:400 40px/1 var(--serif);font-variant-numeric:tabular-nums}
.srp-timer .face span{max-width:104px;text-align:center;font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:#6a4a32}
.srp-timer .ctl{display:flex;gap:8px;align-items:center}
.srp-timer .steps{grid-column:2;margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px;font-size:12.5px}
.srp-timer .steps li{padding:3px 10px;border-radius:999px;background:rgba(34,19,10,.06);color:#5b4230}
.srp-timer .steps li.now{background:#22130a;color:#fff6ec}
.srp-timer .steps li.did{text-decoration:line-through;color:#9a8676}
/* Something to read: the thing itself, with a passage from it and the way in. */
.srp-reading{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px 26px;align-items:center}
.srp-cover{grid-row:1/4;width:168px;min-height:224px;display:flex;flex-direction:column;justify-content:space-between;padding:18px 16px 16px;border-radius:4px 12px 12px 4px;color:#fff;background:linear-gradient(90deg,rgba(0,0,0,.28) 0,rgba(0,0,0,0) 9px),linear-gradient(160deg,color-mix(in srgb,var(--a) 82%,#000),var(--a) 55%,color-mix(in srgb,var(--a) 70%,#fff));box-shadow:inset 0 1px 0 rgba(255,255,255,.3),4px 4px 0 -1px #f4efe6,5px 5px 0 -1px rgba(40,22,10,.3),0 30px 50px -28px color-mix(in srgb,var(--a) 80%,#000);transform:rotate(-2deg);transition:transform .2s ease}
.srp-cover:hover{transform:rotate(0) translateY(-3px)}
.srp-cover b{font:400 20px/1.14 var(--serif);overflow-wrap:anywhere}
.srp-cover span{font:10.5px/1.35 var(--mono);opacity:.85}
.srp-reading blockquote{margin:0;font:italic 400 21px/1.36 var(--serif);color:#2e1c10}
.srp-reading .srp-btn{justify-self:start;text-decoration:none}
.srp-pic{padding:4px 0}
/* A verdict: the one thing left is to say so. */
.srp-verdict{display:flex;flex-wrap:wrap;align-items:center;gap:12px;animation:srp-up .5s .5s both}
.srp-verdict span{font:13px var(--sans);color:#7a5a42}

/* The document: every line is its own field, drawn as what it is. */
.srp-doc{display:grid;gap:1px}
.srp-line{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;column-gap:9px;padding:2px 8px;margin:0 -8px;border-radius:9px;transition:background .2s ease,box-shadow .2s ease}
.srp-line textarea{grid-column:2;display:block;width:100%;resize:none;overflow:hidden;border:0;outline:0;padding:0;margin:0;background:transparent;color:#22130a;font:15.5px/1.6 var(--sans)}
.srp-line textarea::placeholder{color:rgba(34,19,10,.3)}
.srp-line textarea,.srp-line .shown{grid-row:1}
.srp-line .shown{grid-column:2;pointer-events:none;white-space:pre-wrap;overflow-wrap:anywhere;color:#22130a;font:15.5px/1.6 var(--sans)}
.srp-line.p .shown{grid-column:1/-1}
.srp-line .shown b{font-weight:650}
.srp-line .shown mark{background:rgba(255,214,84,.55);color:inherit;border-radius:4px;padding:0 2px}
.srp-line .shown code{font:13.5px var(--mono);background:rgba(120,70,30,.09);border-radius:5px;padding:1px 4px}
.srp-line.rich:not(:focus-within) textarea{color:transparent}
.srp-line.rich:focus-within .shown{display:none}
.srp-line.done .shown{color:#9a8676;text-decoration:line-through}
.srp-line.rule:not(:focus-within){background:linear-gradient(rgba(120,70,30,.22),rgba(120,70,30,.22)) center/calc(100% - 16px) 1px no-repeat}
.srp-line.rule:not(:focus-within) textarea{color:transparent}
.srp-line .mk{grid-column:1;min-width:18px;padding-top:1px;font:15.5px/1.6 var(--sans);color:var(--a);text-align:right;user-select:none}
.srp-line.p .mk{display:none}
.srp-line.p textarea{grid-column:1/-1}
.srp-line.h1 textarea{font:400 30px/1.15 var(--serif);padding:4px 0 2px}
.srp-line.h2 textarea{font:400 23px/1.25 var(--serif);padding:8px 0 1px}
.srp-line.h3 textarea{font:600 12.5px/1.6 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--a);padding-top:8px}
.srp-line.h1 .mk,.srp-line.h2 .mk,.srp-line.h3 .mk{display:none}
.srp-line.h1 textarea,.srp-line.h2 textarea,.srp-line.h3 textarea{grid-column:1/-1}
.srp-line.quote{border-left:3px solid color-mix(in srgb,var(--a) 55%,transparent);border-radius:0 9px 9px 0;padding-left:12px;margin-left:0}
.srp-line.quote .mk{display:none}
.srp-line.quote textarea{grid-column:1/-1;font:italic 400 17px/1.45 var(--serif);color:#3d2a1c}
.srp-line .tick{grid-column:1;width:19px;height:19px;margin-top:4px;border-radius:6px;border:1.5px solid rgba(120,70,30,.45);background:#fff;display:grid;place-items:center;cursor:pointer;padding:0;color:transparent;font-size:12px;line-height:1;transition:background .15s ease,border-color .15s ease,transform .15s ease}
.srp-line .tick:hover{border-color:var(--a);transform:scale(1.12)}
.srp-line.done .tick{background:#1f8a52;border-color:#1f8a52;color:#fff}
.srp-line.done textarea{color:#9a8676;text-decoration:line-through}
.srp-line.dim textarea{font-size:12.5px;color:#9a8676}
.srp-line.blank:not(:focus-within):not(.here) textarea{height:9px!important}
.srp-line.here{background:linear-gradient(90deg,color-mix(in srgb,var(--a) 20%,transparent),color-mix(in srgb,var(--a) 6%,transparent));box-shadow:inset 3px 0 0 var(--a)}
.srp-line:focus-within{background:color-mix(in srgb,var(--a) 9%,transparent)}

/* No work yet. */
.srp-empty{padding:4px 0;display:grid;gap:14px;align-content:start;justify-items:start}
.srp-empty p{margin:0;max-width:56ch;font-size:15px;color:#5b4230}
.srp-empty .acts{display:flex;flex-wrap:wrap;gap:8px}
.srp-working{display:inline-flex;align-items:center;gap:9px;font:14px var(--sans);color:#5b4230}
.srp-working i{width:9px;height:9px;border-radius:50%;background:var(--a);animation:srp-pulse 1.4s ease-in-out infinite}
.srp .srp-btn{border:1px solid #22130a;background:#22130a;color:#fff6ec;border-radius:999px;padding:8px 16px;font:500 13px var(--sans);cursor:pointer}
.srp .srp-btn.quiet{background:rgba(255,255,255,.7);color:#22130a;border-color:rgba(60,30,10,.2)}
.srp .srp-btn:hover{filter:brightness(1.15)}
.srp .srp-btn.quiet:hover{filter:none;border-color:var(--a);background:#fff}

/* Everything else the Journal knows, folded away under the work. */
.srp-more{border-top:1px solid rgba(60,30,10,.12);padding-top:12px}
.srp-more>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font:500 13px var(--sans);color:#6a4a32}
.srp-more>summary::-webkit-details-marker{display:none}
.srp-more>summary::before{content:"›";font-size:16px;color:var(--a);transition:transform .2s ease}
.srp-more[open]>summary::before{transform:rotate(90deg)}
.srp-more>summary em{font-style:normal;font-weight:400;color:#a08268}
.srp-more .in{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px 34px;padding:16px 0 4px}
.srp-sec h4{margin:0 0 7px;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.srp-sec p{margin:0;font-size:13.5px;color:#4a3424}
.srp-steps{margin:0;padding:0;list-style:none;display:grid;gap:5px;font-size:13.5px}
.srp-steps li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px}
.srp-steps li::before{content:"";width:13px;height:13px;margin-top:3px;border-radius:4px;border:1.5px solid rgba(120,70,30,.4)}
.srp-steps li.done{color:#9a8676}
.srp-steps li.done::before{background:#1f8a52;border-color:#1f8a52}
.srp-steps a{color:var(--a)}
.srp-facts{margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:13.5px}
.srp-facts dt{font:11px var(--mono);color:#8a6a52;padding-top:2px}
.srp-facts dd{margin:0}
.srp-rel{margin:0 -9px;padding:0;list-style:none;display:grid;gap:2px}
.srp-rel button{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:baseline;width:100%;text-align:left;padding:5px 9px;border-radius:10px;border:0;background:transparent;cursor:pointer;font-size:13.5px;color:#22130a}
.srp-rel button:hover:not(:disabled){background:rgba(255,255,255,.75)}
.srp-rel button:disabled{cursor:default}
.srp-rel i{width:8px;height:8px;border-radius:50%;border:1.5px solid #a08a78;align-self:center}
.srp-rel i.over{background:#e2661f;border-color:#e2661f}
.srp-rel i.done{background:#1f8a52;border-color:#1f8a52}
.srp-rel i.target{background:#22130a;border-color:#22130a}
.srp-rel em{font-style:normal;margin-left:6px;font:10.5px var(--mono);color:#8a6a52}
.srp-rel .d{font:11px var(--mono);color:#8a6a52;white-space:nowrap}
.srp-sec details{border-top:1px solid rgba(60,30,10,.1);padding-top:8px;margin-top:8px}
.srp-sec details:first-of-type{border-top:0;padding-top:0;margin-top:0}
.srp-sec summary{cursor:pointer;font:500 13px var(--sans);color:#3d2a1c}
.srp-md{font-size:13px;color:#3d2a1c;overflow-wrap:anywhere}
.srp-md p,.srp-md ul,.srp-md ol{margin:6px 0}
.srp-md ul,.srp-md ol{padding-left:18px}
.srp-md a{color:var(--a)}
.srp-md code{font:12px var(--mono)}
.srp-hist{margin:6px 0 0;padding:0;list-style:none;font-size:12.5px;color:#5b4230;display:grid;gap:3px}
.srp-hist span{font:11px var(--mono);color:#8a6a52;margin-right:8px}
.srp-note{margin:0;color:#7a5a42;font-size:13px}

/* Controls. A thing to press looks raised and goes down when pressed; a thing to type in is a well; the one
   thing to do next is the only one in colour. */
.srp-acts button,.srp-chip,.srp .srp-btn.quiet,.srp-links a{border:1px solid rgba(40,22,10,.22);background:linear-gradient(180deg,#fff,#f1ece5);color:#22130a;box-shadow:inset 0 1px 0 #fff,0 2px 0 rgba(40,22,10,.12),0 6px 12px -8px rgba(40,22,10,.4);transition:transform .08s ease,box-shadow .08s ease,filter .15s ease}
.srp-acts button:hover,.srp-chip:hover,.srp .srp-btn.quiet:hover,.srp-links a:hover{background:linear-gradient(180deg,#fff,#f6f2ec);border-color:rgba(40,22,10,.34);transform:none;filter:none}
.srp-acts button:active,.srp-chip:active,.srp .srp-btn.quiet:active,.srp-links a:active{transform:translateY(2px);box-shadow:inset 0 2px 4px rgba(40,22,10,.2)}
.srp-acts .doneb,.srp .srp-btn,.srp .srp-door{border:1px solid #120a05;color:#fff6ec;background:linear-gradient(180deg,#4a3526,#22130a 55%,#170c06);box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 2px 0 #0c0603,0 10px 18px -10px rgba(34,19,10,.8);transition:transform .08s ease,box-shadow .08s ease,filter .15s ease}
.srp-acts .doneb:hover,.srp .srp-btn:hover,.srp .srp-door:hover{background:linear-gradient(180deg,#5a4130,#2c190d 55%,#1c0f07);filter:none;transform:none}
.srp-acts .doneb:active,.srp .srp-btn:active,.srp .srp-door:active{transform:translateY(2px);box-shadow:inset 0 2px 5px rgba(0,0,0,.6)}
.srp .srp-btn.go,.srp .srp-cta{border:1px solid color-mix(in srgb,var(--a) 70%,#000);color:#fff;background:linear-gradient(180deg,color-mix(in srgb,var(--a) 78%,#fff) 0%,var(--a) 52%,color-mix(in srgb,var(--a) 88%,#000) 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 2px 0 color-mix(in srgb,var(--a) 60%,#000),0 12px 22px -12px color-mix(in srgb,var(--a) 90%,#000)}
.srp .srp-btn.go:hover,.srp-cta:hover{background:linear-gradient(180deg,color-mix(in srgb,var(--a) 72%,#fff) 0%,color-mix(in srgb,var(--a) 94%,#fff) 52%,color-mix(in srgb,var(--a) 92%,#000) 100%);transform:none}
.srp .srp-btn.go:active,.srp-cta:active{transform:translateY(2px);box-shadow:inset 0 2px 5px rgba(0,0,0,.3)}
.srp-cta{justify-self:start;display:inline-flex;align-items:center;gap:10px;padding:13px 26px;border-radius:999px;font:600 16px var(--sans);cursor:pointer;animation:srp-ready 2.4s ease-in-out 1s infinite}
.srp-cta:disabled{opacity:.6;cursor:default;animation:none}
.srp-line .tick{width:22px;height:22px;margin-top:1px;border-radius:50%;border:1.5px solid rgba(40,22,10,.4);background:#fff;box-shadow:inset 0 1px 3px rgba(40,22,10,.22)}
.srp-line .tick:hover{border-color:var(--a);box-shadow:inset 0 1px 3px rgba(40,22,10,.22),0 0 0 4px color-mix(in srgb,var(--a) 18%,transparent);transform:none}
.srp-line.done .tick{border-color:#17703f;background:radial-gradient(circle at 35% 28%,#7fe6a8,#1f9a58 70%);box-shadow:inset 0 -1px 2px rgba(0,0,0,.25),0 1px 2px rgba(31,138,82,.4);animation:srp-tick .32s cubic-bezier(.3,1.7,.5,1)}
@keyframes srp-tick{from{transform:scale(.6)}to{transform:scale(1)}}
@keyframes srp-ready{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 2px 0 color-mix(in srgb,var(--a) 60%,#000),0 0 0 0 color-mix(in srgb,var(--a) 45%,transparent)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 2px 0 color-mix(in srgb,var(--a) 60%,#000),0 0 0 9px color-mix(in srgb,var(--a) 0%,transparent)}}
.srp-trail li.more{cursor:pointer;color:var(--a);font-weight:500}
.srp-trail li.more::before{content:none}
@keyframes srp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.82)}}
@keyframes srp-breathe{0%,100%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.09);filter:brightness(1.12)}}
@keyframes srp-drift{from{transform:translate(0,0) scale(1)}to{transform:translate(7%,-5%) scale(1.12)}}
@keyframes srp-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes srp-pop{from{opacity:0;transform:scale(.8) translateY(4px)}to{opacity:1;transform:none}}
@keyframes srp-rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes srp-in{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.srp *,.srp::before,.srp::after{animation:none!important}}

/* A narrow screen: the same column, tighter. */
.narrow .srp-bar{padding:10px 10px 2px 14px;flex-wrap:wrap}
.narrow .srp-name{display:none}
.narrow .srp-scroll{padding:6px 14px 96px}
.narrow .srp-say{grid-template-columns:minmax(0,1fr)}
.narrow .srp-orb{width:24px;height:24px;margin:0 0 6px}
.narrow .srp-work.desk,.narrow .srp-work.desk.listfirst{grid-template-columns:minmax(0,1fr)}
.narrow .win-notes .srp-body{padding:16px 14px 18px 32px;background:linear-gradient(90deg,transparent 19px,rgba(214,90,70,.38) 19px,rgba(214,90,70,.38) 20.5px,transparent 20.5px)}
.narrow .srp-letter label{padding:8px 14px}
.narrow .srp-letter .srp-body{padding:14px}
.narrow .srp-reading{grid-template-columns:minmax(0,1fr)}
.narrow .srp-cover{grid-row:auto;min-height:150px}
.narrow .srp-slides{grid-template-columns:minmax(0,1fr)}
.narrow .srp-slides .strip{flex-direction:row;border-right:0;padding:10px}
.narrow .srp-slides .strip button{flex:0 0 110px;margin-left:0}
.narrow .srp-slides .strip button small{position:static;color:#8a6a52;margin-right:4px}
.narrow .srp-slides .stage{padding:12px}
.narrow .srp-slides .slide{padding:14px 16px}
.narrow .srp-fields label{grid-template-columns:minmax(0,1fr)}
.narrow .srp-fields label>span{text-align:left}
.narrow .srp-timer{grid-template-columns:minmax(0,1fr);justify-items:center}
.narrow .srp-timer .face{grid-row:auto}
.narrow .srp-timer .steps{grid-column:1;justify-content:center}
.narrow .srp-path li{font-size:11.5px}
`;


const WORKSPACE_CSS = `
/* The workspace: the brief, the surfaces, the chats, side by side. */
.srp.ws{display:flex;flex-direction:row}
.srw-brief{flex:none;width:clamp(350px,31%,450px);min-height:0;display:flex;flex-direction:column;border-right:1px solid rgba(60,30,10,.1)}
.srw-brief .srp-bar{flex:none;padding:16px 18px 0 20px}
.srw-brief .srp-scroll{flex:1;padding:8px 20px 18px}
.srp .srw-brief .srp-col{max-width:none;gap:16px}
.srw-brief .srp-say{grid-template-columns:minmax(0,1fr);padding-top:4px}
.srw-brief .srp-orb{display:none}
.srw-brief .srp-say h2{font-size:27px;line-height:1.08}
.srw-brief .srp-say .why{font-size:14.5px}
.srw-brief .srp-ribbon b{font-size:17px}
.srw-brief .srp-ribbon div{flex-basis:120px;padding:0 12px}
.srw-brief .srp-more .in{grid-template-columns:minmax(0,1fr)}
.srw-foot{flex:none;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:10px 16px 14px;border-top:1px solid rgba(60,30,10,.1)}
.srw-mid{position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;padding:10px 12px 12px}
.srw-tabs{flex:none;display:flex;align-items:flex-end;gap:6px;min-width:0}
.srw-tablist{position:relative;flex:1;min-width:0;display:flex;align-items:flex-end;gap:2px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.srw-tablist::-webkit-scrollbar{display:none}
.srw-tab{flex:none;max-width:168px;display:inline-flex;align-items:center;gap:7px;padding:9px 13px 10px;border:0;border-radius:13px 13px 0 0;background:transparent;color:#6a4a32;font:500 13.5px var(--sans);cursor:pointer;white-space:nowrap}
.srw-tab small{flex:none;font:500 9px var(--mono);letter-spacing:.08em;text-transform:uppercase;padding:2px 6px;border-radius:999px;background:rgba(34,19,10,.1);color:#5b4230}
.srw-tab span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.srw-tab:hover{color:#22130a;background:rgba(255,255,255,.45)}
.srw-tab[aria-selected=true]{max-width:240px;background:#fff;color:#22130a;box-shadow:0 -1px 0 rgba(255,255,255,.9),0 -8px 18px -14px rgba(120,60,10,.5)}
.srw-tab[aria-selected=true] small{background:#22130a;color:#fff6ec}
.srw-ico{flex:none;height:34px;min-width:34px;margin-bottom:5px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 9px;border-radius:11px;border:1px solid rgba(40,22,10,.18);background:linear-gradient(180deg,#fff,#f1ece5);color:#22130a;font:500 13px var(--sans);cursor:pointer;box-shadow:inset 0 1px 0 #fff,0 2px 0 rgba(40,22,10,.1)}
.srw-ico:hover{border-color:rgba(40,22,10,.34)}
.srw-ico[aria-pressed=true]{background:#22130a;border-color:#22130a;color:#fff6ec;box-shadow:none}
.srw-ico em{font:600 10.5px var(--mono);font-style:normal;padding:1px 6px;border-radius:999px;background:rgba(34,19,10,.1)}
.srw-ico[aria-pressed=true] em{background:#fff6ec;color:#22130a}
.srw-ico em.waiting{background:var(--a);color:#fff}
.srw-ico .pane{width:15px;height:13px;border-radius:3px;border:1.5px solid currentColor;box-sizing:border-box;background:linear-gradient(90deg,currentColor 0 34%,transparent 34%)}
.srw-add{flex:none;margin-bottom:5px;display:flex;align-items:center;gap:6px}
.srw-add input{width:210px;max-width:40vw;height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(40,22,10,.2);background:#fff;font:12.5px var(--mono);color:#22130a;outline:0}
.srw-add input:focus{border-color:var(--a)}
.srw-add input.bad{border-color:#d2451a}
.srw-surface{position:relative;flex:1;min-height:0;overflow:hidden;border-radius:14px;background:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.95);box-shadow:inset 0 1px 0 #fff,0 18px 44px -30px rgba(120,60,10,.55)}
.srw-work{position:absolute;inset:0;overflow:auto;overscroll-behavior:contain;padding:20px 22px 30px}
.srw-work .srp-col{gap:18px}
.srw-paste{display:grid;gap:8px;padding-top:14px;border-top:1px solid rgba(60,30,10,.12);max-width:56ch}
.srw-paste label{font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.srw-paste form{display:flex;gap:8px}
.srw-paste input{flex:1;min-width:0;height:36px;padding:0 14px;border-radius:999px;border:1px solid rgba(40,22,10,.2);background:#fff;font:13px var(--mono);color:#22130a;outline:0}
.srw-paste input:focus{border-color:var(--a)}
.srw-paste p{margin:0;font-size:12.5px;color:#7a5a42}
.srw-chats{flex:none;width:clamp(320px,27%,390px);min-height:0;border-left:1px solid rgba(60,30,10,.1);background:rgba(255,255,255,.42)}
/* Two parts fit, not three: the brief or the chats beside the surface, one at a time. */
.srp.cols-2 .srw-brief{width:clamp(320px,40%,400px)}
.srp.cols-2 .srw-chats{width:clamp(300px,38%,360px)}
/* A phone: one column. The brief opens over it; the chats are a sheet under the surface. */
.srp.cols-1{flex-direction:column}
.cols-1 .srw-brief{position:absolute;inset:0;z-index:6;width:auto;border-right:0;background:linear-gradient(180deg,#fbfcff 0%,#fffaf5 55%,#fff4e8 100%)}
.cols-1 .srw-brief .srp-bar{padding:12px 12px 0 16px}
.cols-1 .srw-brief .srp-scroll{padding:6px 16px 16px}
.cols-1 .srw-foot{justify-content:flex-start}
.cols-1 .srw-mid{padding:8px 8px 0}
.cols-1 .srw-tab{padding:8px 10px 9px;max-width:150px}
.cols-1 .srw-tab[aria-selected=true]{max-width:190px}
.cols-1 .srw-work{padding:14px 12px 24px}
.cols-1 .srw-chats{flex:0 0 60%;width:auto;border-left:0;border-top:1px solid rgba(60,30,10,.14);background:#fffaf4;box-shadow:0 -14px 30px -22px rgba(60,30,10,.6)}
.cols-1 .srk-mini{margin:0 -8px;padding:8px 10px 10px}
.srk-mini .srk-box .srk-box{flex:1;min-width:0}
.srw-mid>.srk-mini{margin:8px -12px -12px;border-radius:0}
.cols-1 .srw-mid>.srk-mini{margin:8px -8px 0}
`;

export const PANE_CSS = BRIEF_AND_WORK_CSS + WORKSPACE_CSS + BROWSER_SURFACE_CSS + CHATS_CSS;

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const dayFrom = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isInternal = (href: string) => href.startsWith('/');
const outLink = (href: string) => (isInternal(href) ? {} : { target: '_blank', rel: 'noopener noreferrer' });
// Journal ids mean nothing to him: a sentence that quotes one reads without it.
const noIds = (text: string) => text
  .replace(/\s*\(?\b(?:id|task id)\s*[:=]?\s*['"]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]?\)?/gi, '')
  .replace(/\s*['"]?\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b['"]?/gi, '')
  .replace(/\(\s*\)/g, '').replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
const SRC_LABEL: Record<string, string> = { canvas: 'canvas', email: 'email', web: 'web', journal: 'journal', notes: 'notes', jobs: 'jobs' };

// ───────────── the document ─────────────

// A line of the work: what marks it (a heading, a tick box, a bullet, a number, a quote), and its words.
interface Line { indent: string; mark: string; text: string }
const MARK = /^(\s*)(#{1,3}\s+|[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+[.)]\s+|>\s+)?(.*)$/;
const parseLine = (raw: string): Line => {
  const m = MARK.exec(raw);
  return m ? { indent: m[1], mark: m[2] ?? '', text: m[3] } : { indent: '', mark: '', text: raw };
};
const lineKind = (mark: string): 'h1' | 'h2' | 'h3' | 'check' | 'done' | 'bullet' | 'num' | 'quote' | 'p' => {
  if (mark.startsWith('###')) return 'h3';
  if (mark.startsWith('##')) return 'h2';
  if (mark.startsWith('#')) return 'h1';
  if (/\[[xX]\]/.test(mark)) return 'done';
  if (/\[ \]/.test(mark)) return 'check';
  if (/^[-*]/.test(mark)) return 'bullet';
  if (/^\d/.test(mark)) return 'num';
  if (mark.startsWith('>')) return 'quote';
  return 'p';
};
const toText = (lines: Line[]) => lines.map((l) => l.indent + l.mark + l.text).join('\n');
// The mark a new line takes after this one: lists go on, everything else starts plain.
const nextMark = (mark: string): string => {
  const kind = lineKind(mark);
  if (kind === 'check' || kind === 'done') return '- [ ] ';
  if (kind === 'bullet') return mark;
  if (kind === 'num') return `${Number(/^\d+/.exec(mark)?.[0] ?? 0) + 1}. `;
  return '';
};
// A numbered list counts on from its first line, whatever was added or taken out of it.
function renumber(lines: Line[]): Line[] {
  let n = 0, indent: string | null = null;
  return lines.map((line) => {
    if (lineKind(line.mark) !== 'num') { n = 0; indent = null; return line; }
    n = indent === line.indent ? n + 1 : Number(/^\d+/.exec(line.mark)?.[0] ?? 1);
    indent = line.indent;
    return { ...line, mark: line.mark.replace(/^\d+/, String(n)) };
  });
}
const isAside = (text: string) => /^_\(.*\)_$/.test(text.trim());
// The marks inside a line (**bold**, ==highlight==, *italic*, `code`), drawn as what they mean while the line is
// not being typed in. Null when the line has none, so it stays a plain field.
const INLINE = /(\*\*[^*\n]+?\*\*|==[^=\n]+?==|`[^`\n]+?`|(?<![\w*])\*[^*\s][^*\n]*?\*(?![\w*]))/g;
function inlineMarks(text: string): React.ReactNode[] | null {
  const pieces = text.split(INLINE);
  if (pieces.length < 2) return null;
  return pieces.map((piece, i) => {
    if (i % 2 === 0) return piece;
    if (piece.startsWith('**')) return <b key={i}>{piece.slice(2, -2)}</b>;
    if (piece.startsWith('==')) return <mark key={i}>{piece.slice(2, -2)}</mark>;
    if (piece.startsWith('`')) return <code key={i}>{piece.slice(1, -1)}</code>;
    return <i key={i}>{piece.slice(1, -1)}</i>;
  });
}
const isRule = (line: Line) => line.mark === '' && /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line.text);
/** The line to pick up from: the first box not ticked, else the first line left open, else the last one written. */
function jumpIndex(lines: Line[]): number {
  const open = lines.findIndex((l) => lineKind(l.mark) === 'check');
  if (open >= 0) return open;
  const blank = lines.findIndex((l) => (l.mark !== '' && l.text.trim() === '') || /[:：]\s*$/.test(l.text));
  if (blank >= 0) return blank;
  for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i].text.trim() && !isAside(lines[i].text)) return i;
  return 0;
}

/** The work as a document: each line is its own field, drawn as what it is, and Enter and Backspace behave. */
function Doc({ value, onChange, focusJump, lit }: { value: string; onChange: (text: string) => void; focusJump: boolean; lit: boolean }) {
  const lines = React.useMemo(() => value.split('\n').map(parseLine), [value]);
  const fields = React.useRef<(HTMLTextAreaElement | null)[]>([]);
  const caret = React.useRef<{ index: number; at: number } | null>(null);
  const [here, setHere] = React.useState<number | null>(() => (lit ? jumpIndex(value.split('\n').map(parseLine)) : null));

  // Every field is as tall as its words, and stays so when the page it is on changes width (the pane grows in).
  const root = React.useRef<HTMLDivElement>(null);
  const fit = React.useCallback(() => {
    fields.current.forEach((el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } });
  }, []);
  React.useEffect(() => {
    const host = root.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    let width = host.clientWidth;
    const watch = new ResizeObserver(() => { if (host.clientWidth !== width) { width = host.clientWidth; fit(); } });
    watch.observe(host);
    return () => watch.disconnect();
  }, [fit]);
  React.useLayoutEffect(() => {
    fit();
    if (caret.current) {
      const { index, at } = caret.current;
      caret.current = null;
      const el = fields.current[index];
      if (el) { el.focus(); el.setSelectionRange(at, at); }
    }
  });
  // Opening the task puts the caret at the place to pick up from, once the sheet has grown in.
  React.useEffect(() => {
    if (!focusJump || here === null) return;
    const timer = window.setTimeout(() => {
      const el = fields.current[here];
      if (!el) return;
      // The page opens on what OpenClaw says; the caret waits at the line to pick up from, lit, further down.
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }, 750);
    return () => window.clearTimeout(timer);
    // Only when the task opens: the lit line stays where it was found.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (next: Line[], at?: { index: number; at: number }) => {
    if (at) caret.current = at;
    onChange(toText(renumber(next)));
  };
  const edit = (index: number, text: string) => {
    setHere(null);
    if (!text.includes('\n')) { commit(lines.map((l, i) => (i === index ? { ...l, text } : l))); return; }
    // Pasted lines land as lines.
    const [first, ...rest] = text.split('\n');
    const pasted = rest.map(parseLine);
    commit([...lines.slice(0, index), { ...lines[index], text: first }, ...pasted, ...lines.slice(index + 1)], { index: index + pasted.length, at: pasted[pasted.length - 1].text.length });
  };
  const onKey = (index: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget, line = lines[index];
    const at = el.selectionStart, plain = el.selectionStart === el.selectionEnd;
    const kind = lineKind(line.mark);
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      setHere(null);
      // Enter on an empty list line ends the list.
      if (line.text === '' && (kind === 'check' || kind === 'done' || kind === 'bullet' || kind === 'num' || kind === 'quote')) {
        commit(lines.map((l, i) => (i === index ? { ...l, mark: '' } : l)), { index, at: 0 });
        return;
      }
      const made: Line = { indent: line.indent, mark: nextMark(line.mark), text: line.text.slice(el.selectionEnd) };
      commit([...lines.slice(0, index), { ...line, text: line.text.slice(0, at) }, made, ...lines.slice(index + 1)], { index: index + 1, at: 0 });
    } else if (e.key === 'Backspace' && plain && at === 0) {
      if (line.mark !== '') {
        e.preventDefault();
        commit(lines.map((l, i) => (i === index ? { ...l, mark: '' } : l)), { index, at: 0 });
      } else if (index > 0) {
        e.preventDefault();
        const before = lines[index - 1];
        commit([...lines.slice(0, index - 1), { ...before, text: before.text + line.text }, ...lines.slice(index + 1)], { index: index - 1, at: before.text.length });
      }
    } else if (e.key === 'ArrowUp' && plain && at === 0 && index > 0) {
      e.preventDefault();
      fields.current[index - 1]?.focus();
    } else if (e.key === 'ArrowDown' && plain && at === el.value.length && index < lines.length - 1) {
      e.preventDefault();
      const next = fields.current[index + 1];
      next?.focus();
      next?.setSelectionRange(0, 0);
    }
  };
  const tick = (index: number) => {
    setHere(null);
    commit(lines.map((l, i) => (i === index ? { ...l, mark: l.mark.replace(/\[([ xX])\]/, (_, c: string) => (c === ' ' ? '[x]' : '[ ]')) } : l)));
  };

  return (
    <div className="srp-doc" ref={root}>
      {lines.map((line, index) => {
        const kind = lineKind(line.mark);
        const rich = kind === 'p' || kind === 'bullet' || kind === 'num' || kind === 'check' || kind === 'done' ? inlineMarks(line.text) : null;
        return (
          <div key={index} className={`srp-line ${kind}${index === here ? ' here' : ''}${isAside(line.text) ? ' dim' : ''}${kind === 'p' && line.text === '' && lines.length > 1 ? ' blank' : ''}${rich !== null ? ' rich' : ''}${isRule(line) ? ' rule' : ''}`}>
            {kind === 'check' || kind === 'done' ? (
              <button type="button" className="tick" aria-label={kind === 'done' ? 'Untick' : 'Tick'} aria-pressed={kind === 'done'} onClick={() => tick(index)}>✓</button>
            ) : (
              <span className="mk" aria-hidden="true">{kind === 'bullet' ? '•' : kind === 'num' ? line.mark.trim() : ''}</span>
            )}
            <textarea
              ref={(el) => { fields.current[index] = el; }}
              rows={1}
              value={line.text}
              spellCheck
              placeholder={index === here ? 'Pick it up here…' : lines.length === 1 ? 'Start writing…' : ''}
              aria-label={`Line ${index + 1}`}
              onChange={(e) => edit(index, e.target.value)}
              onKeyDown={(e) => onKey(index, e)}
            />
            {rich !== null && <div className="shown" aria-hidden="true">{rich}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** The task's parts, drawn large and unboxed: facts in one strip, stages as a path, the rest by the shapes bank. */
function Facts({ parts }: { parts: Part[] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const rest = React.useMemo(() => parts.filter((part) => part.kind !== 'pairs' && part.kind !== 'steps'), [parts]);
  React.useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren(...rest.map((part) => renderPart(part, 2)));
    return () => host.replaceChildren();
  }, [rest]);
  return (
    <>
      {parts.map((part, i) => part.kind === 'steps' ? (
        <ol key={i} className="srp-path">
          {part.items.map((item, j) => {
            const [label = '', date = ''] = item.split(' · ');
            return <li key={j} className={j < part.at ? 'did' : j === part.at ? 'now' : undefined}>{label}{date && <small>{date}</small>}</li>;
          })}
        </ol>
      ) : part.kind === 'pairs' ? (
        <div key={i} className="srp-ribbon">
          {part.items.map((pair, j) => <div key={j}><b>{pair.value}</b><span>{pair.key}</span></div>)}
        </div>
      ) : null)}
      {rest.length > 0 && <div ref={ref} className="srp-parts" />}
    </>
  );
}

// ───────────── the work, block by block ─────────────

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** A countdown for a rehearsal, a workout or a sprint. It runs here and is not kept. */
function TimerBlock({ block }: { block: Extract<WorkBlock, { kind: 'timer' }> }) {
  const [left, setLeft] = React.useState(block.seconds);
  const [running, setRunning] = React.useState(false);
  React.useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setLeft((s) => { if (s <= 1) { setRunning(false); return 0; } return s - 1; }), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const steps = block.steps ?? [];
  const at = steps.length ? Math.min(steps.length - 1, Math.floor(((block.seconds - left) / block.seconds) * steps.length)) : -1;
  return (
    <div className="srp-timer">
      <div className="face"><b>{clock(left)}</b><span>{block.label}</span></div>
      <div className="ctl">
        <button type="button" className="srp-btn" onClick={() => { if (left === 0) setLeft(block.seconds); setRunning((r) => !r); }}>{running ? 'Pause' : left === block.seconds ? 'Start' : left === 0 ? 'Again' : 'Go on'}</button>
        {left !== block.seconds && <button type="button" className="srp-chip" onClick={() => { setRunning(false); setLeft(block.seconds); }}>Reset</button>}
      </div>
      {steps.length > 0 && <ol className="steps">{steps.map((step, i) => <li key={i} className={i === at && left !== block.seconds ? 'now' : i < at ? 'did' : undefined}>{step}</li>)}</ol>}
    </div>
  );
}

// How many boxes a checklist has, and how many are ticked.
const tallyOf = (body: string) => {
  const boxes = body.split('\n').filter((l) => /^\s*[-*]\s+\[[ xX]\]/.test(l));
  return { all: boxes.length, ticked: boxes.filter((l) => /\[[xX]\]/.test(l)).length };
};

/** A small icon from the shapes bank. */
function Ico({ name }: { name: IconName }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren(iconOf(name));
    return () => host.replaceChildren();
  }, [name]);
  return <span ref={ref} style={{ display: 'contents' }} aria-hidden="true" />;
}

/** An object's frame: its bar names it and shows how it stands. */
function Win({ app, icon, title, right, className, children }: {
  app: string; icon: IconName; title: string; right?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={`srp-block srp-win win-${app}${className ? ` ${className}` : ''}`}>
      <div className="srp-title"><Ico name={icon} /><b>{title}</b>{right && <span className="r">{right}</span>}</div>
      {children}
    </div>
  );
}

/**
 * One block of the work, drawn as the object it is. `lead` is the block to jump into: it is lit, takes the caret,
 * and its bar carries `status` (whether what he typed is saved).
 */
function BlockView({ block, title, href, lead, status, focusJump, onChange }: {
  block: WorkBlock; title: string; href: string | null; lead: boolean; status: React.ReactNode; focusJump: boolean; onChange: (block: WorkBlock) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const state = lead ? status : undefined;
  switch (block.kind) {
    case 'doc':
      return (
        <Win app="notes" icon="notes" title={block.label ?? title} right={state}>
          <div className="srp-body">
            <Doc value={block.body} onChange={(body) => onChange({ ...block, body })} focusJump={lead && focusJump} lit={lead} />
          </div>
        </Win>
      );
    case 'checklist': {
      const boxes = block.body.split('\n').filter((l) => /^\s*[-*]\s+\[[ xX]\]/.test(l)).map((l) => /\[[xX]\]/.test(l));
      const ticked = boxes.filter(Boolean).length;
      return (
        <Win app="list" icon="list" title={block.label ?? 'To tick'}
          right={boxes.length > 0 ? <>{boxes.length <= 12 && <span className="srp-pips" aria-hidden="true">{boxes.map((on, i) => <i key={i} className={on ? 'on' : undefined} />)}</span>}{ticked} of {boxes.length}</> : state}>
          <div className="srp-body">
            <Doc value={block.body} onChange={(body) => onChange({ ...block, body })} focusJump={lead && focusJump} lit={lead} />
          </div>
        </Win>
      );
    }
    case 'letter': {
      const mailto = `mailto:${encodeURIComponent(block.to)}?subject=${encodeURIComponent(block.subject)}&body=${encodeURIComponent(block.body)}`;
      return (
        <Win app="mail" icon="mail" title="New message" right="Draft · not sent" className="srp-letter">
          <label><span>To</span><input value={block.to} onChange={(e) => onChange({ ...block, to: e.target.value })} aria-label="To" /></label>
          <label><span>Subject</span><input value={block.subject} onChange={(e) => onChange({ ...block, subject: e.target.value })} aria-label="Subject" /></label>
          <div className="srp-body">
            <Doc value={block.body} onChange={(body) => onChange({ ...block, body })} focusJump={lead && focusJump} lit={lead} />
          </div>
          <div className="srp-under">
            {block.to.includes('@') && <a className="srp-btn go" href={mailto} style={{ color: '#fff' }}>Open it in your mail ↗</a>}
            <button type="button" className="srp-btn quiet" onClick={() => { void navigator.clipboard?.writeText(block.body).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }}>{copied ? 'Copied ✓' : 'Copy the words'}</button>
            {href && <a href={href} target="_blank" rel="noopener noreferrer">Open the thread ↗</a>}
            <span className="sp">OpenClaw drafts. Sending is yours.</span>
          </div>
        </Win>
      );
    }
    case 'problem':
      return (
        <Win app="problem" icon="problem" title={block.label ?? 'Problem'} right={state} className="srp-problem">
          <div className="srp-body">
            <p className="prompt">{block.prompt}</p>
            {block.given && <pre>{block.given}</pre>}
            <span className="srp-lab">Your work</span>
            <Doc value={block.work} onChange={(work) => onChange({ ...block, work })} focusJump={lead && focusJump} lit={lead} />
          </div>
        </Win>
      );
    case 'fields': {
      const filled = block.items.filter((f) => f.value.trim() !== '').length;
      return (
        <Win app="form" icon="doc" title={block.label ?? 'The form'} right={`${filled} of ${block.items.length} filled`} className="srp-fields">
          <div className="srp-body">
            {block.items.map((field, i) => (
              <label key={i} className={field.needs && field.value.trim() === '' ? 'needs' : undefined}>
                <span>{field.label}</span>
                <input
                  value={field.value}
                  placeholder={field.needs ? field.hint ?? 'Only you know this' : ''}
                  onChange={(e) => onChange({ ...block, items: block.items.map((f, j) => (j === i ? { ...f, value: e.target.value } : f)) })}
                />
                {field.needs && field.value.trim() === '' && <i>Only you can fill this in</i>}
              </label>
            ))}
          </div>
          {href && <div className="srp-under"><a href={href} target="_blank" rel="noopener noreferrer">Open the real form ↗</a><span className="sp">Nothing is submitted from here.</span></div>}
        </Win>
      );
    }
    case 'choices':
      return (
        <div className="srp-block srp-choices">
          <p className="prompt">{block.prompt}</p>
          <div className="opts" role="radiogroup" aria-label={block.prompt}>
            {block.options.map((option, i) => (
              <button key={i} type="button" role="radio" className={block.picked === i ? 'on' : undefined} aria-checked={block.picked === i}
                onClick={() => onChange({ ...block, ...(block.picked === i ? { picked: undefined } : { picked: i }) })}>
                <b>{option.title}</b>
                {option.detail && <span>{option.detail}</span>}
                {option.points && <ul>{option.points.map((point, j) => <li key={j}>{point}</li>)}</ul>}
              </button>
            ))}
          </div>
        </div>
      );
    case 'slides': {
      const slide = block.items[block.at] ?? block.items[0];
      const set = (patch: Partial<typeof slide>) => onChange({ ...block, items: block.items.map((s, j) => (j === block.at ? { ...s, ...patch } : s)) });
      return (
        <Win app="deck" icon="slides" title={title} right={`Slide ${block.at + 1} of ${block.items.length}`}>
          <div className="srp-slides">
            <div className="strip" role="tablist" aria-label="Slides">
              {block.items.map((s, i) => (
                <button key={i} type="button" role="tab" aria-selected={i === block.at} className={i === block.at ? 'on' : undefined} onClick={() => onChange({ ...block, at: i })}>
                  <small>{i + 1}</small><span>{s.title}</span>
                </button>
              ))}
            </div>
            <div className="stage">
              <div className="slide">
                <input className="ttl" value={slide.title} onChange={(e) => set({ title: e.target.value })} aria-label="Slide title" />
                <Doc key={block.at} value={slide.body ?? ''} onChange={(body) => set({ body })} focusJump={lead && focusJump} lit={false} />
              </div>
              <label className="notes"><span>What you will say</span>
                <textarea rows={2} value={slide.notes ?? ''} placeholder="Speaker notes" onChange={(e) => set({ notes: e.target.value })} />
              </label>
            </div>
          </div>
        </Win>
      );
    }
    case 'timer':
      return <Win app="timer" icon="timer" title={block.label}><div className="srp-body"><TimerBlock block={block} /></div></Win>;
    case 'reading':
      return (
        <div className="srp-block srp-reading">
          <div className="srp-cover"><b>{block.title}</b>{block.by && <span>{block.by}</span>}</div>
          {block.excerpt && <blockquote>{block.excerpt}</blockquote>}
          {block.href && <a className="srp-btn" href={block.href} target="_blank" rel="noopener noreferrer">Open it ↗</a>}
        </div>
      );
    case 'part':
      return <div className="srp-block srp-pic"><Facts parts={[block.part]} /></div>;
  }
}

/** The started work: the step to take now, then its blocks, which save themselves as he works in them. */
function WorkCard({ taskId, work, next, focusJump, narrow, quiet, onWork }: {
  taskId: string; work: ResolvedWork; next: string; focusJump: boolean; narrow: boolean; quiet: boolean; onWork: (work: ResolvedWork | null) => void;
}) {
  const [blocks, setBlocks] = React.useState(work.blocks);
  const [state, setState] = React.useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const saved = React.useRef(work.blocks);
  const timer = React.useRef<number | null>(null);
  const latest = React.useRef(blocks);
  latest.current = blocks;

  const save = React.useCallback(async (next: WorkBlock[]) => {
    if (next === saved.current) return;
    setState('saving');
    try {
      const json = await post('/api/tasks/hook-work', { taskId, action: 'save', blocks: next, baseHash: work.baseHash });
      if (!json?.success) { setState('failed'); return; }
      saved.current = next;
      setState('saved');
    } catch {
      setState('failed');
    }
  }, [taskId, work.baseHash]);
  const change = (block: WorkBlock) => {
    const next = latest.current.map((b) => (b.id === block.id ? block : b));
    setBlocks(next);
    setState('idle');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(next), 800);
  };
  // Leaving the task saves what is still unsaved.
  React.useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (latest.current !== saved.current) void post('/api/tasks/hook-work', { taskId, action: 'save', blocks: latest.current, baseHash: work.baseHash }).catch(() => {});
  }, [taskId, work.baseHash]);

  const takeTheirs = async () => {
    if (timer.current) window.clearTimeout(timer.current);
    saved.current = latest.current;   // his version is being dropped on purpose: nothing to save on the way out
    const json = await post('/api/tasks/hook-work', { taskId, action: 'reset' }).catch(() => null);
    if (json?.success) onWork((json.data as ResolvedWork | null) ?? null);
  };
  const edited = work.edited || blocks !== work.blocks;
  const status = (
    <>
      <i className={`led${state === 'saving' ? ' busy' : state === 'failed' ? ' bad' : ''}`} aria-hidden="true" />
      <span role="status">{state === 'saving' ? 'Saving…' : state === 'failed' ? 'Not saved. Keep typing to retry' : state === 'saved' || edited ? 'Saved' : 'Started by OpenClaw'}</span>
    </>
  );
  // The block to jump into is the first one he acts in; what comes before it is context.
  const lead = blocks.findIndex(isActive);
  // Two things on the desk: a short list sits beside the page, letter or form it goes with, on the side it came.
  const listAt = blocks.length === 2 ? blocks.findIndex((b) => b.kind === 'checklist' && tallyOf(b.body).all <= 7) : -1;
  const other = listAt >= 0 ? blocks[1 - listAt] : undefined;
  const desk = !narrow && other !== undefined && (other.kind === 'doc' || other.kind === 'letter' || other.kind === 'fields' || other.kind === 'problem');
  const host = React.useRef<HTMLElement>(null);
  // The one thing to do next: pressing it takes him to the lit line, with the caret in it.
  const jump = () => {
    const field = host.current?.querySelector<HTMLElement>('.srp-line.here textarea, .srp-fields label.needs input') ?? host.current?.querySelector<HTMLElement>('textarea, input');
    if (!field) return;
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field.focus({ preventScroll: true });
  };

  return (
    <section ref={host} className={`srp-work${desk ? ` desk${listAt === 0 ? ' listfirst' : ''}` : ''}`} aria-label="The work, started">
      {!quiet && (
        <div className="srp-jumprow">
          <button type="button" className="srp-jump" onClick={jump}><i className="play" aria-hidden="true">▶</i><span>{next || work.title}</span></button>
          {work.href && <a href={work.href} target="_blank" rel="noopener noreferrer">Finish it there ↗</a>}
        </div>
      )}
      {blocks.map((block, index) => (
        <BlockView key={block.id} block={block} title={work.title} href={work.href} lead={index === Math.max(0, lead)} status={status} focusJump={focusJump} onChange={change} />
      ))}
      {(work.newer || work.edited) && (
        <div className="srp-foot">
          {work.newer && <span>OpenClaw has started this again since you worked on it.</span>}
          {work.edited && <button type="button" className="srp-chip" onClick={() => void takeTheirs()}>{work.newer ? 'Take OpenClaw’s new version' : 'Back to OpenClaw’s start'}</button>}
        </div>
      )}
    </section>
  );
}

// ───────────── the side ─────────────

function Oc({ item }: { item: { oc?: true; src: string } }) {
  if (!item.oc) return null;
  const read = SRC_LABEL[item.src];
  return <span className="srp-oc" title={read ? `OpenClaw read this in ${read}` : 'OpenClaw’s inference, not something it read. May be wrong.'}>{read ? `OpenClaw · ${read}` : 'OpenClaw guess'}</span>;
}

/** A fix OpenClaw suggests beside a warning: press, confirm, done. */
function Fix({ action, brief, onDone }: { action: BriefAction; brief: TaskBrief; onDone: (id: string) => void }) {
  const [phase, setPhase] = React.useState<'idle' | 'confirm' | 'running' | 'done'>(action.done ? 'done' : 'idle');
  const [error, setError] = React.useState<string | null>(null);
  if (phase === 'done') return <div className="srp-act"><span className="ok">Done: {action.label}</span></div>;
  const run = async () => {
    setPhase('running');
    setError(null);
    try {
      await runBriefAction(action, brief);
      setPhase('done');
      onDone(action.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work.');
      setPhase('confirm');
    }
  };
  return (
    <div className="srp-act">
      {phase === 'idle' ? (
        <button type="button" className="srp-chip" onClick={() => setPhase('confirm')}>{action.label}</button>
      ) : (
        <>
          <span>{confirmText(action, brief)}</span>
          <button type="button" className="srp-chip" disabled={phase === 'running'} onClick={() => void run()}>{phase === 'running' ? 'Working…' : 'Confirm'}</button>
          <button type="button" className="srp-chip" disabled={phase === 'running'} onClick={() => { setPhase('idle'); setError(null); }}>Cancel</button>
          {action.kind === 'save-notes' && <pre>{action.markdown}</pre>}
          {error && <span className="err" role="alert">{error}</span>}
        </>
      )}
    </div>
  );
}

function ago(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** What OpenClaw wants him to know before he starts, said plainly, with a one-press fix where there is one. */
function Asides({ brief, warnings, onActionDone }: { brief: TaskBrief; warnings: boolean; onActionDone: (id: string) => void }) {
  // A warning, or anything with a fix to press, is said before the work; the rest waits with what the Journal knows.
  const flags = brief.flags.filter((f) => (f.level === 'warn' || f.action !== undefined) === warnings);
  if (flags.length === 0) return null;
  return (
    <div className="srp-asides">
      {flags.map((f, i) => (
        <div key={i} className={`srp-flag ${f.level}`}>
          {noIds(f.text)}<Oc item={f} />
          {f.action && <Fix action={f.action} brief={brief} onDone={onActionDone} />}
        </div>
      ))}
    </div>
  );
}

/** Everything else the Journal knows, folded away under the work. Nothing is drawn for what it does not know. */
function More({ brief, what, onGoto, onActionDone }: { brief: TaskBrief; what: string; onGoto: (id: string) => void; onActionDone: (id: string) => void }) {
  const go = (r: BriefRelated) => { if (r.state !== 'target' && r.state !== 'done') onGoto(r.taskId); };
  const notes = brief.flags.filter((f) => f.level !== 'warn' && f.action === undefined).length;
  const has = [
    notes > 0 && `${notes} thing${notes === 1 ? '' : 's'} to know`,
    brief.steps.length > 0 && `${brief.steps.length} step${brief.steps.length === 1 ? '' : 's'}`,
    brief.related.length > 0 && `${brief.related.length} connected`,
    brief.facts.length > 0 && `${brief.facts.length} fact${brief.facts.length === 1 ? '' : 's'}`,
    brief.sections.length > 0 && 'notes',
    brief.history.length > 0 && 'history',
  ].filter((entry): entry is string => typeof entry === 'string');
  if (has.length === 0 && what === '') return null;
  return (
    <details className="srp-more" open={brief.runway ? true : undefined}>
      <summary>What the Journal knows<em>{has.join(' · ')}</em></summary>
      <div className="in">
        {what !== '' && <section className="srp-sec"><h4>What it is</h4><p>{what}</p></section>}
        {notes > 0 && <section className="srp-sec"><h4>Good to know</h4><Asides brief={brief} warnings={false} onActionDone={onActionDone} /></section>}
        {brief.related.length > 0 && (
          <section className="srp-sec">
            <h4>{brief.runway ? 'Runway to the exam' : 'Connected'}</h4>
            <ul className="srp-rel">
              {brief.related.map((r) => (
                <li key={r.taskId}>
                  <button type="button" onClick={() => go(r)} disabled={r.state === 'target' || r.state === 'done'}>
                    <i className={r.state} aria-hidden="true" />
                    <span>{r.short}<em>{r.rel}</em></span>
                    <span className="d">{r.day}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {brief.steps.length > 0 && (
          <section className="srp-sec">
            <h4>Steps</h4>
            <ul className="srp-steps">
              {brief.steps.map((st, i) => (
                <li key={i} className={st.done ? 'done' : undefined}>
                  <span>{st.href ? <a href={st.href} {...outLink(st.href)}>{st.text}</a> : st.text}<Oc item={st} /></span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {brief.facts.length > 0 && (
          <section className="srp-sec">
            <h4>Facts</h4>
            <dl className="srp-facts">
              {brief.facts.map((f, i) => <React.Fragment key={i}><dt>{f.k}</dt><dd>{f.v}<Oc item={f} /></dd></React.Fragment>)}
            </dl>
          </section>
        )}
        {(brief.sections.length > 0 || brief.history.length > 0) && (
          <section className="srp-sec">
            {brief.sections.map((sec) => (
              <details key={sec.title}>
                <summary>{sec.title}<Oc item={sec} /></summary>
                <div className="srp-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, ...props }) => <a href={href} {...props} {...(href ? outLink(href) : {})} /> }}>{sec.markdown}</ReactMarkdown>
                </div>
              </details>
            ))}
            {brief.history.length > 0 && (
              <details>
                <summary>History</summary>
                <ul className="srp-hist">{brief.history.map((h, i) => <li key={i}><span>{h.when}</span>{h.text}</li>)}</ul>
              </details>
            )}
          </section>
        )}
      </div>
    </details>
  );
}

// The page's colour comes from what the task is: its sun, its accent and the sky over it.
type Hue = { a: string; glow: string; sky: string };
const HUES: Record<string, Hue> = {
  warm: { a: '#c2551b', glow: '#ffc98a', sky: '#cfe4ff' },
  mail: { a: '#2563c9', glow: '#b4d3ff', sky: '#ffe6c8' },
  stage: { a: '#8b3fd1', glow: '#e4c6ff', sky: '#ffdbe9' },
  read: { a: '#0f8573', glow: '#aeeeda', sky: '#dff1ff' },
  build: { a: '#3f4fd6', glow: '#c2caff', sky: '#d6f8ff' },
  out: { a: '#d23a68', glow: '#ffc4d3', sky: '#ffeccb' },
  done: { a: '#1f8a52', glow: '#bff0d0', sky: '#e6f4ff' },
  time: { a: '#b07a00', glow: '#ffe394', sky: '#ffe6d8' },
};
const ICON_HUE: Record<string, keyof typeof HUES> = {
  mail: 'mail', call: 'mail', slides: 'stage', video: 'stage', chart: 'stage', read: 'read', link: 'read', code: 'build', app: 'build', jobs: 'build',
  event: 'out', workout: 'out', flame: 'out', sun: 'out', check: 'done', list: 'done', problem: 'time', timer: 'time', clock: 'time',
};
// The kind of page: what the work is decides how wide it is and what it looks like.
const SCENES: Record<WorkBlock['kind'], string> = {
  doc: 'page', checklist: 'list', letter: 'letter', problem: 'problem', fields: 'form', choices: 'pick', slides: 'deck', timer: 'timer', reading: 'read', part: 'page',
};

// ───────────── the pane ─────────────

// The word on a work tab: what sort of thing the work is.
const WORK_TAGS: Record<WorkBlock['kind'], string> = {
  doc: 'doc', checklist: 'list', letter: 'mail', problem: 'work', fields: 'form', choices: 'pick', slides: 'slides', timer: 'timer', reading: 'read', part: 'work',
};
// How wide the opened pane is for a sky this wide (engine.ts workRect), and how many of the three parts fit.
const paneWidthFor = (sky: number) => (sky < 700 ? sky - 16 : Math.min(1480, sky - 32));
const colsFor = (sky: number): 1 | 2 | 3 => (sky < 700 ? 1 : paneWidthFor(sky) >= 1180 ? 3 : 2);

export function TaskPane({ taskId, data, onClose, onGoto, onChanged, onLetGo, onUndo }: {
  taskId: string;
  data: SunriseData;
  onClose: () => void;
  onGoto: (taskId: string) => void;
  onChanged: () => void;
  onLetGo: (target: { id: string; listType: string; short: string; title: string }) => void;
  onUndo: (text: string, run: () => Promise<unknown>) => void;
}) {
  const [brief, setBrief] = React.useState<TaskBrief | null | undefined>(undefined);   // undefined while loading
  const [work, setWork] = React.useState<ResolvedWork | null | undefined>(undefined);
  const [allDid, setAllDid] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const eyebrow = React.useRef<HTMLSpanElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const surfaceBox = React.useRef<HTMLDivElement>(null);

  // How much room there is: three parts side by side, two, or one column on a phone. It follows the sky's width,
  // not the pane's own, which is still growing out of the task's form when this first draws.
  const [cols, setCols] = React.useState<1 | 2 | 3>(() => (typeof window === 'undefined' ? 3 : colsFor(window.innerWidth)));
  const [briefOpen, setBriefOpen] = React.useState(() => cols >= 2);
  const [chatsOpen, setChatsOpen] = React.useState(() => cols === 3);
  const [surfaceWidth, setSurfaceWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const sky = root.current?.closest<HTMLElement>('.sr-sky');
    if (!sky) return;
    const first = colsFor(sky.clientWidth);
    setCols(first);
    setBriefOpen(first >= 2);
    setChatsOpen(first === 3);
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => setCols(colsFor(sky.clientWidth)));
    watch.observe(sky);
    return () => watch.disconnect();
  }, []);
  React.useEffect(() => {
    const el = surfaceBox.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => setSurfaceWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  // With room for two, the brief and the chats take turns beside the surface.
  const showBrief = (on: boolean) => { setBriefOpen(on); if (on && cols === 2) setChatsOpen(false); };
  const showChats = (on: boolean) => { setChatsOpen(on); if (on && cols === 2) setBriefOpen(false); };
  React.useEffect(() => { if (cols === 2 && briefOpen && chatsOpen) setChatsOpen(false); }, [cols, briefOpen, chatsOpen]);

  const loadBrief = React.useCallback(() => {
    fetch(`/api/tasks/brief?id=${encodeURIComponent(taskId)}`)
      .then((r) => r.json())
      .then((json) => setBrief(json.success ? json.data as TaskBrief : null))
      .catch(() => setBrief((b) => b ?? null));
  }, [taskId]);
  React.useEffect(() => { loadBrief(); }, [loadBrief]);
  // Opening a task marks it started, and brings back its work as it stands: his text, or OpenClaw's.
  React.useEffect(() => {
    let cancelled = false;
    post('/api/tasks/hook-work', { taskId, action: 'open' })
      .then((json) => { if (!cancelled) setWork(json?.success ? (json.data as ResolvedWork | null) : null); })
      .catch(() => { if (!cancelled) setWork(null); });
    return () => { cancelled = true; };
  }, [taskId]);

  // While OpenClaw is still on it, check back; when it lands, the work it started arrives with it.
  const filling = brief?.agent?.status === 'queued' || brief?.agent?.status === 'running';
  const hookBody = brief?.hook?.work ? JSON.stringify(brief.hook.work.blocks) : null;
  React.useEffect(() => {
    if (!filling) return;
    const timer = window.setInterval(loadBrief, 8000);
    return () => window.clearInterval(timer);
  }, [filling, loadBrief]);
  const seenBody = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (brief === undefined) return;
    const first = seenBody.current === undefined;
    const changed = seenBody.current !== hookBody;
    seenBody.current = hookBody;
    if (first || !changed || hookBody === null) return;   // the open call above brought the work as it stood
    fetch(`/api/tasks/hook-work?id=${encodeURIComponent(taskId)}`)
      .then((r) => r.json())
      .then((json) => { if (json?.success) setWork(json.data as ResolvedWork | null); })
      .catch(() => {});
  }, [brief, hookBody, taskId]);

  const form = data.forms[taskId];
  const item = [...data.horizon.items, ...data.horizon.holds, ...data.horizon.further].find((i) => i.id === taskId);
  const listType = brief?.listType ?? form?.listType ?? item?.listType ?? 'have-to-do';
  const title = brief?.title ?? item?.title ?? form?.name ?? '';
  const short = (brief?.short ?? item?.short ?? form?.name ?? 'the task').replace(/[.…]+$/, '');
  const undated = brief ? brief.when.zone === 'undated' : !item;
  const when = brief?.when;
  const due = undated ? '' : when ? [when.day, when.left].filter(Boolean).join(' · ') : item ? [item.day, item.left].filter(Boolean).join(' · ') : '';
  const zone = when?.zone ?? item?.zone;
  const next = form?.next || brief?.next?.label || '';
  const parts = React.useMemo(() => form?.parts ?? [], [form]);
  const icon = form?.icon;
  React.useEffect(() => {
    const host = eyebrow.current;
    if (!host || !icon) return;
    const svg = iconOf(icon);
    host.prepend(svg);
    return () => svg.remove();
  }, [icon, briefOpen]);

  // ---- The surfaces: the work, and one page per real link. Which is showing, and which pages he has opened.
  const [pasted, setPasted] = React.useState<string[]>([]);
  const n = brief?.next;
  const surfaces = React.useMemo<Surface[]>(() => deriveSurfaces({
    links: brief?.links ?? [],
    next: n ? { label: n.label, ...(n.href ? { href: n.href } : {}) } : null,
    work: work ? { title: work.title, href: work.href, blocks: work.blocks.length } : null,
    pasted,
  }), [brief?.links, n, work, pasted]);
  const hasWork = !!work && work.blocks.length > 0;
  // He has not chosen a tab until he presses one: until then the task shows where it would open by itself.
  const [picked, setPicked] = React.useState<string | null>(null);
  const settled = brief !== undefined && work !== undefined;
  const selectedId = picked !== null && surfaces.some((surface) => surface.id === picked) ? picked : settled ? defaultSurfaceId(surfaces, hasWork) : 'work';
  const selected = surfaces.find((surface) => surface.id === selectedId) ?? surfaces[0];
  // With more tabs than fit, the one that is showing is brought into view.
  const tablist = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const list = tablist.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected=true]');
    if (!list || !tab) return;
    if (tab.offsetLeft < list.scrollLeft) list.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = tab.offsetLeft + tab.offsetWidth - list.clientWidth;
  }, [selectedId, surfaces.length]);
  // A page is opened in OpenClaw's browser only once he chooses it; where the task opens by itself does not count.
  const [armed, setArmed] = React.useState<Record<string, true>>({});
  const [opened, setOpened] = React.useState<Record<string, OpenedTab>>({});
  const [pages, setPages] = React.useState<Record<string, { url: string; title: string }>>({});
  const choose = React.useCallback((id: string) => {
    setPicked(id);
    if (id !== 'work') setArmed((was) => (was[id] ? was : { ...was, [id]: true }));
  }, []);
  /** Shows a page as a tab, adding one when the task has no tab for it. Null when it is not a web address. */
  const showPage = React.useCallback((href: string): string | null => {
    const url = safeWebUrl(href);
    if (url === null) return null;
    const key = pageKey(url);
    const live = Object.entries(pages).find(([, page]) => pageKey(page.url) === key)?.[0];
    const id = surfaces.find((surface) => surface.kind === 'web' && pageKey(surface.url) === key)?.id ?? live ?? surfaceId(url);
    if (!surfaces.some((surface) => surface.id === id)) setPasted((was) => [...was, url]);
    choose(id);
    return id;
  }, [surfaces, pages, choose]);
  // When the workspace closes, the application worker gets OpenClaw's browser back straight away.
  const usedBrowser = React.useRef(false);
  usedBrowser.current = Object.keys(opened).length > 0;
  React.useEffect(() => () => {
    if (usedBrowser.current) void fetch('/api/openclaw/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'end' }), keepalive: true }).catch(() => {});
  }, []);
  // A link in the brief shows its page here; with a modifier key it opens the ordinary way.
  const linkClick = (href: string) => (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0 || isInternal(href)) return;
    if (showPage(href) === null) return;
    event.preventDefault();
    if (cols === 1) setBriefOpen(false);
  };

  // ---- The chats. What he is on goes with every message.
  const about = React.useMemo<ChatSurfaceRef | null>(() => {
    if (!selected) return null;
    if (selected.kind === 'work') return hasWork ? { kind: 'work', label: selected.label } : null;
    const page = pages[selected.id];
    return { kind: 'web', label: page?.title || selected.label, url: page?.url || selected.url };
  }, [selected, pages, hasWork]);
  const chats = useTaskChats(taskId, chatsOpen);
  const showSurface = React.useCallback((ref: ChatSurfaceRef) => {
    if (ref.kind === 'work') choose('work');
    else if (ref.url) showPage(ref.url);
  }, [choose, showPage]);
  const [adding, setAdding] = React.useState(false);
  const [addText, setAddText] = React.useState('');
  const [addBad, setAddBad] = React.useState(false);
  const addPage = (event: React.FormEvent) => {
    event.preventDefault();
    if (showPage(addText) === null) { setAddBad(true); return; }
    setAdding(false);
    setAddText('');
    setAddBad(false);
  };

  const done = async () => {
    setBusy(true);
    setError(null);
    const body = { taskId, listType, date: getCurrentDateISO() };
    const json = await post('/api/tasks/today/complete', body).catch(() => null);
    setBusy(false);
    if (!json?.success) { setError(json?.error || 'That did not save. Try again.'); return; }
    onClose();
    onUndo(`Done: ${short}.`, () => post('/api/tasks/today/complete', body));
    onChanged();
  };
  const setWhen = async (dueDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;
    setError(null);
    const json = await post('/api/tasks/update', { taskId, listType, dueDate }).catch(() => null);
    if (!json?.success) { setError(json?.error || 'That did not save. Try again.'); return; }
    onChanged();
    loadBrief();
  };
  const refresh = async () => {
    await post('/api/tasks/brief-agent', { action: 'refresh', taskId }).catch(() => null);
    loadBrief();
  };
  const startOwn = async () => {
    // Starting it himself: the task's own steps to tick, when the Journal has them, and a page to write on.
    const steps = brief?.steps ?? [];
    const blocks: WorkBlock[] = [
      ...(steps.length > 0 ? [{ kind: 'checklist' as const, id: 'steps', label: 'Steps', body: steps.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`).join('\n') }] : []),
      { kind: 'doc', id: 'notes', label: 'Your notes', body: '' },
    ];
    const json = await post('/api/tasks/hook-work', { taskId, action: 'save', blocks }).catch(() => null);
    if (json?.success) {
      setWork((json.data as ResolvedWork | null) ?? { title: short, href: null, blocks, edited: true, baseHash: null, newer: null, startedAt: null });
      setPicked('work');
    }
  };
  const actionDone = (actionId: string) => {
    void post('/api/tasks/brief-agent', { action: 'action-done', taskId, actionId }).then(() => { onChanged(); loadBrief(); });
  };
  // On a wide sheet the caret goes straight to the place to pick up from; on a phone that would raise the keyboard.
  const focusJump = cols > 1;

  const lead = work ? work.blocks.find(isActive) ?? work.blocks[0] : undefined;
  // The form's rows are its small picture of a list; opened, the list itself is there to tick.
  const listed = work?.blocks.some((block) => block.kind === 'checklist') ?? false;
  const shown = React.useMemo(() => parts.filter((part) => !(listed && part.kind === 'rows')), [parts, listed]);
  const tally = work && work.blocks.length === 1 && lead?.kind === 'checklist' ? tallyOf(lead.body) : null;
  // A task whose list has one box left, or none, is a verdict, not a workspace: the statement, and one button.
  const verdict = tally !== null && tally.all - tally.ticked <= 1;
  const scene = verdict ? 'verdict' : lead ? SCENES[lead.kind] : 'empty';
  const hue = HUES[ICON_HUE[icon ?? ''] ?? 'warm'];
  const a = brief?.agent;
  const says = form?.ready ? form.say : null;
  const headline = says?.[0] || form?.name || title;
  const why = says ? says[1] : form?.what ?? '';
  const links = (brief?.links ?? []).filter((l) => l.href !== n?.href);
  const webCount = surfaces.length - 1;

  return (
    <div ref={root} className={`srp ws cols-${cols} scene-${scene}${work && work.blocks.length === 2 ? ' desk' : ''}`} style={{ '--a': hue.a, '--glow': hue.glow, '--sky': hue.sky } as React.CSSProperties}>
      {briefOpen && (
        <aside className="srw-brief" aria-label="The brief">
          <header className="srp-bar">
            <span className="srp-eyebrow" ref={eyebrow}>
              <span>{form?.kind}</span>
              {due && <span className={`srp-due${zone === 'hold' ? ' over' : zone === 'ignition' ? ' soon' : ''}`}>{due}</span>}
              {when?.where && <span className="srp-where">{when.where}</span>}
            </span>
            {cols === 1 && <div className="srp-acts"><button type="button" className="x" onClick={() => setBriefOpen(false)} aria-label="Back to the work">✕</button></div>}
          </header>
          <div className="srp-scroll">
            <div className="srp-col">
              <section className="srp-say">
                <div>
                  <span className="srp-who" role="status">
                    OpenClaw
                    {a?.status === 'running' && <em>is reading Canvas, email and your journal for this…</em>}
                    {a?.status === 'queued' && <em>will look at this shortly</em>}
                    {a?.status === 'done' && <em>looked {ago(a.finishedAt)}</em>}
                    {a?.status === 'failed' && <em>couldn’t look at this{a.error ? `: ${a.error}` : ''}</em>}
                    {a && !filling && <button type="button" onClick={() => void refresh()}>{a.status === 'failed' ? 'Retry' : 'Look again'}</button>}
                  </span>
                  <h2>{headline}</h2>
                  {says && form && form.name !== headline && <p className="srp-note">{form.name}</p>}
                  {why && <p className="why">{why}</p>}
                  {form && form.did.length > 0 && (
                    <ul className="srp-trail" aria-label="OpenClaw already">
                      {(allDid ? form.did : form.did.slice(0, 2)).map((d, i) => <li key={d} style={{ animationDelay: `${0.3 + i * 0.12}s` }}>{d}</li>)}
                      {!allDid && form.did.length > 2 && <li className="more" role="button" tabIndex={0} onClick={() => setAllDid(true)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAllDid(true); }}>and {form.did.length - 2} more</li>}
                    </ul>
                  )}
                  {(n?.href || n?.taskId || links.length > 0) && (
                    <div className="srp-doors">
                      {n?.href ? <a className="srp-door" href={n.href} {...outLink(n.href)} onClick={linkClick(n.href)}>{n.label}<span>{isInternal(n.href) ? '→' : '↗'}</span></a>
                        : n?.taskId ? <button type="button" className="srp-door" onClick={() => onGoto(n.taskId as string)}>{n.label}<span>→</span></button> : null}
                      <span className="srp-links">
                        {links.map((l) => (
                          <a key={l.href} href={l.href} title={l.label} {...outLink(l.href)} onClick={linkClick(l.href)}><small>{l.kind === 'app' ? 'journal' : l.kind}</small><span>{l.label}</span></a>
                        ))}
                      </span>
                    </div>
                  )}
                  {undated && (
                    <div className="srp-when">
                      No date yet. When?
                      <button type="button" className="srp-chip" onClick={() => void setWhen(dayFrom(0))}>Today</button>
                      <button type="button" className="srp-chip" onClick={() => void setWhen(dayFrom(1))}>Tomorrow</button>
                      <button type="button" className="srp-chip" onClick={() => void setWhen(dayFrom(7))}>Next week</button>
                      <input type="date" aria-label="A date for this task" min={dayFrom(0)} onChange={(e) => void setWhen(e.target.value)} />
                    </div>
                  )}
                </div>
              </section>
              {shown.length > 0 && <Facts parts={shown} />}
              {brief && <Asides brief={brief} warnings onActionDone={actionDone} />}
              {brief ? <More brief={brief} what={says ? form?.what ?? '' : ''} onGoto={onGoto} onActionDone={actionDone} />
                : <p className="srp-note">{brief === undefined ? 'Gathering what the Journal knows…' : 'Could not load what the Journal knows about this task.'}</p>}
            </div>
          </div>
          <footer className="srw-foot srp-acts">
            {error && <p className="srp-err" role="alert" style={{ margin: '0 auto 0 0' }}>{error}</p>}
            <button type="button" onClick={() => onLetGo({ id: taskId, listType, short, title })} disabled={busy}
              title="No longer worth doing. Takes it off your lists without counting it as done.">Let go</button>
            <button type="button" className="doneb" onClick={() => void done()} disabled={busy}>{busy ? 'Saving…' : 'Done'}</button>
          </footer>
        </aside>
      )}
      <div className="srw-mid">
        <div className="srw-tabs">
          <button type="button" className="srw-ico" aria-pressed={briefOpen} onClick={() => showBrief(!briefOpen)} aria-label={briefOpen ? 'Fold the brief away' : 'Show the brief'} title="The brief"><i className="pane" aria-hidden="true" /></button>
          <div ref={tablist} className="srw-tablist" role="tablist" aria-label="What is open for this task">
            {surfaces.map((surface) => (
              <button key={surface.id} type="button" role="tab" className="srw-tab" aria-selected={surface.id === selectedId} title={surface.kind === 'web' ? surface.url : surface.label} onClick={() => choose(surface.id)}>
                <small>{surface.kind === 'web' ? 'web' : lead ? WORK_TAGS[lead.kind] : 'work'}</small>
                <span>{surface.kind === 'web' ? pages[surface.id]?.title || surface.label : hasWork ? surface.label : 'Work'}</span>
              </button>
            ))}
          </div>
          {adding ? (
            <form className="srw-add" onSubmit={addPage}>
              <input autoFocus value={addText} className={addBad ? 'bad' : undefined} placeholder="Paste a web address" aria-label="A web address to open in OpenClaw’s browser" aria-invalid={addBad}
                onChange={(e) => { setAddText(e.target.value); setAddBad(false); }}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { setAdding(false); setAddBad(false); } }}
                onBlur={() => { if (!addText.trim()) setAdding(false); }} />
            </form>
          ) : (
            <button type="button" className="srw-ico" onClick={() => setAdding(true)} aria-label="Open another page in OpenClaw’s browser" title="Open a page in OpenClaw’s browser">+</button>
          )}
          <button type="button" className="srw-ico" aria-pressed={chatsOpen} onClick={() => showChats(!chatsOpen)} title="Chats with OpenClaw about this task">
            Chats{chats.threads.length > 0 && <em className={chats.waiting > 0 ? 'waiting' : undefined}>{chats.threads.length}</em>}
          </button>
          <button type="button" className="srw-ico" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div ref={surfaceBox} className="srw-surface" role="tabpanel" aria-label={selected?.label}>
          {selected?.kind === 'web' ? (
            <BrowserSurface
              key={selected.id}
              surface={selected}
              armed={armed[selected.id] === true}
              covered={cols === 1 && briefOpen}
              opened={opened[selected.id] ?? null}
              narrow={cols === 1}
              onArm={() => choose(selected.id)}
              onOpened={(tab) => setOpened((was) => {
                const rest = Object.fromEntries(Object.entries(was).filter(([id]) => id !== selected.id));
                return tab ? { ...rest, [selected.id]: tab } : rest;
              })}
              onPage={(page) => setPages((was) => (was[selected.id]?.url === page.url && was[selected.id]?.title === page.title ? was : { ...was, [selected.id]: page }))}
            />
          ) : (
            <div className="srw-work">
              <div className="srp-col">
                {work ? (
                  <WorkCard key={`${work.baseHash}|${work.edited}`} taskId={taskId} work={work} next={next} focusJump={focusJump && !verdict} narrow={surfaceWidth < 820} quiet={verdict} onWork={setWork} />
                ) : (
                  <section className="srp-work srp-empty" aria-label="The work">
                    {work === undefined ? <p>Opening…</p> : filling ? (
                      <span className="srp-working"><i aria-hidden="true" />OpenClaw is reading what it can reach and starting the first piece. It will appear here.</span>
                    ) : (
                      <p>Nothing is started here yet. OpenClaw works through your tasks one at a time, soonest first. You can send it to this one now, or start it yourself{brief && brief.steps.length > 0 ? ` from its ${brief.steps.length} step${brief.steps.length === 1 ? '' : 's'}` : ''}.</p>
                    )}
                    {work === null && (
                      <div className="acts">
                        {!filling && <button type="button" className="srp-btn" onClick={() => void refresh()}>Have OpenClaw start it now</button>}
                        <button type="button" className="srp-btn quiet" onClick={() => void startOwn()}>Start it yourself here</button>
                      </div>
                    )}
                    {work === null && webCount === 0 && (
                      <div className="srw-paste">
                        <label htmlFor="srw-paste">Or open a page</label>
                        <form onSubmit={addPage}>
                          <input id="srw-paste" value={addText} placeholder="Paste a web address" aria-invalid={addBad}
                            onChange={(e) => { setAddText(e.target.value); setAddBad(false); }} onKeyDown={(e) => e.stopPropagation()} />
                          <button type="submit" className="srp-btn quiet" disabled={!addText.trim()}>Open in OpenClaw’s browser</button>
                        </form>
                        <p>{addBad ? 'That is not a web address.' : 'This task has no links yet. A page you paste opens in OpenClaw’s own browser, as a tab here.'}</p>
                      </div>
                    )}
                  </section>
                )}
                {verdict && (
                  <div className="srp-verdict">
                    <button type="button" className="srp-cta" onClick={() => void done()} disabled={busy}>{busy ? 'Saving…' : 'Mark it done'}</button>
                    <span>It leaves your list and counts as cleared. You can undo it right after.</span>
                  </div>
                )}
                {!briefOpen && error && <p className="srp-err" role="alert">{error}</p>}
              </div>
            </div>
          )}
        </div>
        {!chatsOpen && <MiniChat chats={chats} about={about} onOpen={() => showChats(true)} />}
      </div>
      {chatsOpen && (
        <aside className="srw-chats">
          <ChatsPanel chats={chats} about={about} autoFocus={cols > 1} onShowSurface={showSurface} onClose={() => setChatsOpen(false)} />
        </aside>
      )}
    </div>
  );
}
