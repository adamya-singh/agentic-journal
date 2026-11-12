'use client';

// What a task opens to in Sunrise. One bright sheet built around a single thing: the place to jump in.
// - On the left, the work OpenClaw started, as a document you keep writing in right here. The line to pick up
//   from is lit and takes the caret, so opening a task drops you into work that is already moving.
// - On the right, what the Journal knows, in the order you would need it: warnings with their one-press fixes,
//   a picture of the work, where it gets done, steps, facts, connected tasks, and the longer notes folded away.
// - Under that, OpenClaw: ask it about the task or tell it what to do next.
// The engine grows the pane out of the task's form; this fills it.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getCurrentDateISO } from '@/lib/current-date';
import type { BriefAction, BriefRelated, TaskBrief } from '@/lib/task-brief';
import type { ResolvedWork } from '@/lib/hook-work';
import type { Part } from '@/lib/shapes/catalog';
import { isActive, type WorkBlock } from '@/lib/shapes/work';
import { iconOf, renderPart } from '@/lib/shapes/render';
import type { SunriseData } from '@/lib/sunrise/data';
import { BriefChat } from '@/components/horizon/BriefChat';
import { confirmText, runBriefAction } from '@/components/horizon/brief-actions';

export const PANE_CSS = `
/* Daylight: a warm sun low in the sheet, sky above it, and glass panels that pick both up. */
.srp{position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr);gap:14px;padding:20px 22px 18px;color:#22130a;font:14px/1.5 var(--sans);isolation:isolate;
  background:radial-gradient(90% 70% at 18% 112%,#ffc98a 0%,rgba(255,214,160,.6) 34%,rgba(255,230,200,0) 62%),radial-gradient(70% 60% at 96% -8%,#cfe4ff 0%,rgba(222,236,255,.55) 40%,rgba(240,246,255,0) 70%),linear-gradient(180deg,#fbfcff 0%,#fff8ef 55%,#ffeeda 100%)}
.srp::before{content:"";position:absolute;z-index:-1;left:-8%;bottom:-30%;width:56%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,rgba(255,170,90,.55),rgba(255,170,90,0) 68%);filter:blur(10px);pointer-events:none}
.srp-glass{background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.46));backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5);border:1px solid rgba(255,255,255,.95);border-radius:20px;
  box-shadow:inset 0 1px 0 #fff,inset 0 -1px 0 rgba(255,255,255,.4),0 18px 44px -26px rgba(120,60,10,.55),0 2px 6px -3px rgba(120,60,10,.18)}

/* The head: what it is, when, its name, and what OpenClaw already did. */
.srp-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:start}
.srp-eyebrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:500 10.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#9a5a24}
.srp-eyebrow .icon{width:14px;height:14px;color:#b4521a}
.srp-due{letter-spacing:.04em;text-transform:none;font:500 11.5px var(--mono);padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.7);border:1px solid rgba(180,82,26,.25);color:#7a3d14}
.srp-due.soon{background:#b4521a;border-color:#b4521a;color:#fff6ec}
.srp-due.over{background:#22130a;border-color:#22130a;color:#ffd9b8}
.srp-where{letter-spacing:.02em;text-transform:none;font:12px var(--sans);color:#6a4a32}
.srp h2{grid-column:1;margin:2px 0 0;font:400 clamp(26px,2.7vw,38px)/1.04 var(--serif);letter-spacing:-.005em;text-wrap:balance}
.srp-what{grid-column:1;margin:4px 0 0;max-width:68ch;font-size:14px;color:#5b4230}
.srp-acts{grid-column:2;grid-row:1/4;display:flex;gap:8px;align-items:center}
.srp-acts button{border:1px solid rgba(60,30,10,.16);background:rgba(255,255,255,.6);border-radius:999px;padding:7px 15px;font:500 13px var(--sans);cursor:pointer;transition:transform .15s ease,border-color .15s ease,background .15s ease}
.srp-acts button:hover{border-color:#e07a3a;background:#fff;transform:translateY(-1px)}
.srp-acts button:disabled{opacity:.5;cursor:default;transform:none}
.srp-acts .doneb{background:#22130a;color:#fff6ec;border-color:#22130a;box-shadow:0 8px 18px -10px rgba(34,19,10,.8)}
.srp-acts .doneb:hover{background:#3a2112;border-color:#3a2112}
.srp-acts .x{width:36px;height:36px;padding:0;display:grid;place-items:center;font-size:15px}
.srp-did{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
.srp-did span{font:500 10px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#b4521a;margin-right:2px}
.srp-did i{font:12.5px var(--sans);font-style:normal;color:#3d2a1c;padding:3px 10px 3px 8px;border-radius:999px;background:rgba(255,255,255,.62);border:1px solid rgba(255,255,255,.95);box-shadow:0 1px 2px rgba(120,60,10,.08)}
.srp-did i::before{content:"✓";color:#1f8a52;font-weight:600;margin-right:5px}
.srp-when{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;font:13px var(--sans);color:#6a4426}
.srp-chip{border:1px solid rgba(60,30,10,.18);background:rgba(255,255,255,.7);border-radius:999px;padding:4px 12px;font:500 12.5px var(--sans);cursor:pointer;color:#22130a}
.srp-chip:hover{border-color:#e07a3a;background:#fff}
.srp-chip:disabled{opacity:.5;cursor:default}
.srp-when input{border:1px solid rgba(60,30,10,.18);border-radius:999px;background:rgba(255,255,255,.8);color:#22130a;height:28px;padding:0 10px;font:12px var(--sans)}
.srp-err{grid-column:1/-1;margin:4px 0 0;color:#a3361a;font-size:12.5px}

.srp-body{min-height:0;display:grid;grid-template-columns:minmax(0,1.38fr) minmax(290px,1fr);gap:14px}

/* The work: the step to take now, then its blocks, each drawn as what it is. */
.srp-work{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:0 2px 4px 0;overscroll-behavior:contain}
.srp-jump{flex:none;display:flex;align-items:center;gap:12px;padding:12px 18px;border-radius:18px;background:linear-gradient(90deg,rgba(255,196,128,.6),rgba(255,240,222,.5) 70%)}
.srp-jump .dot{flex:none;width:10px;height:10px;border-radius:50%;background:#e2661f;box-shadow:0 0 0 4px rgba(226,102,31,.2);animation:srp-pulse 2.2s ease-in-out infinite}
.srp-jump .lab{display:block;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:#a6541d}
.srp-jump b{display:block;font:400 21px/1.15 var(--serif);color:#22130a;text-wrap:balance}
.srp-jump .right{margin-left:auto;display:grid;justify-items:end;gap:2px;flex:none;font:11px var(--mono);color:#8a6a52;text-align:right}
.srp-jump a,.srp-under a{color:#b4521a;text-decoration:none;font:500 12px var(--sans);white-space:nowrap}
.srp-jump a:hover,.srp-under a:hover{text-decoration:underline}
.srp-block{flex:none}
.srp-sheet{padding:16px 20px 18px;border-radius:18px;background:rgba(255,255,255,.88);border:1px solid rgba(255,255,255,.95);box-shadow:0 14px 36px -24px rgba(120,60,10,.5),0 1px 3px rgba(120,60,10,.08)}
.srp-lab{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:#a6541d}
.srp-lab em{margin-left:auto;font-style:normal;letter-spacing:.04em;text-transform:none;color:#8a6a52}
.srp-under{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(180,110,50,.16);font:12px var(--sans);color:#8a6a52}
.srp-foot{flex:none;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:2px 6px;font:12px var(--sans);color:#7a5a42}
.srp-foot .srp-chip{padding:2px 10px;font-size:11.5px}
/* A letter: who it goes to, what it is about, then the words. */
.srp-letter label{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(180,110,50,.14);font:12px var(--mono);color:#8a6a52}
.srp-letter label input,.srp-fields input,.srp-slides .ttl{width:100%;border:0;outline:0;background:transparent;color:#22130a;font:14.5px var(--sans);padding:2px 0}
.srp-letter .srp-doc{margin-top:12px}
.srp-letter .srp-line textarea{font:400 16.5px/1.55 var(--serif)}
/* A problem: what is asked, what is given, and the work, started. */
.srp-problem .prompt{margin:0 0 10px;font:400 20px/1.3 var(--serif);color:#22130a;white-space:pre-wrap}
.srp-problem pre{margin:0 0 12px;padding:10px 12px;border-radius:12px;background:#22130a;color:#ffe9d2;font:12.5px/1.55 var(--mono);overflow:auto;white-space:pre}
.srp-problem .srp-doc{padding:8px 10px;border-radius:12px;background:repeating-linear-gradient(#fffdf9,#fffdf9 24px,#f3e7d8 25px);min-height:76px}
.srp-problem .srp-line textarea{font:15px/1.65 var(--mono)}
/* A form: what is filled, and what needs him. */
.srp-fields label{display:grid;grid-template-columns:minmax(110px,34%) minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 10px;margin:0 -10px;border-radius:10px;font:13px var(--sans);color:#6a4a32}
.srp-fields label+label{border-top:1px solid rgba(180,110,50,.1)}
.srp-fields input{padding:5px 9px;border-radius:9px;background:rgba(34,19,10,.045)}
.srp-fields input:focus{background:#fff;box-shadow:0 0 0 2px rgba(226,102,31,.35)}
.srp-fields label.needs{background:linear-gradient(90deg,rgba(255,196,128,.4),rgba(255,236,214,.2))}
.srp-fields label.needs input{background:#fff}
.srp-fields label i{font:500 10px var(--mono);font-style:normal;letter-spacing:.06em;text-transform:uppercase;color:#c2551b}
/* A choice: its options side by side. */
.srp-choices .prompt{margin:0 0 8px 4px;font:400 19px/1.25 var(--serif)}
.srp-choices .opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.srp-choices .opts button{display:flex;flex-direction:column;gap:6px;text-align:left;padding:14px 14px 12px;cursor:pointer;color:#22130a;font:13px/1.4 var(--sans);transition:transform .15s ease,box-shadow .15s ease}
.srp-choices .opts button:hover{transform:translateY(-2px)}
.srp-choices .opts b{font:400 19px/1.15 var(--serif)}
.srp-choices .opts span{color:#5b4230}
.srp-choices .opts ul{margin:0;padding-left:16px;color:#5b4230;font-size:12.5px}
.srp-choices .opts em{margin-top:auto;padding-top:6px;font:500 11px var(--mono);font-style:normal;letter-spacing:.06em;text-transform:uppercase;color:#b4521a}
.srp-choices .opts button.on{background:linear-gradient(180deg,#fff,#ffe9d2);border-color:#e2661f;box-shadow:0 0 0 2px rgba(226,102,31,.35),0 18px 40px -22px rgba(180,82,26,.7)}
.srp-choices .opts button.on em{color:#1f7a4a}
/* A deck: the slides in a strip, and the one being worked on. */
.srp-slides .strip{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 10px}
.srp-slides .strip button{flex:0 0 132px;aspect-ratio:16/9;display:flex;flex-direction:column;justify-content:space-between;text-align:left;padding:7px 9px;border-radius:10px;border:1px solid rgba(60,30,10,.14);background:rgba(255,255,255,.7);cursor:pointer;color:#3d2a1c;font:500 11.5px/1.2 var(--sans)}
.srp-slides .strip button small{font:10px var(--mono);color:#a6541d}
.srp-slides .strip button span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.srp-slides .strip button.on{background:#fff;border-color:#e2661f;box-shadow:0 0 0 2px rgba(226,102,31,.3)}
.srp-slides .slide{aspect-ratio:16/9;display:flex;flex-direction:column;gap:8px;overflow:auto}
.srp-slides .ttl{font:400 28px/1.15 var(--serif);padding:0}
.srp-slides .slide .srp-doc{flex:1}
.srp-slides .notes{display:grid;gap:4px;padding-top:8px;border-top:1px dashed rgba(180,110,50,.3);font:500 9.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#a6541d}
.srp-slides .notes textarea{resize:vertical;border:0;outline:0;background:transparent;color:#5b4230;font:13.5px/1.5 var(--sans);letter-spacing:0;text-transform:none}
/* A timer: the time left, big, and its steps. */
.srp-timer{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 18px;align-items:center}
.srp-timer .face{grid-row:1/3;width:132px;height:132px;border-radius:50%;display:grid;place-content:center;justify-items:center;background:radial-gradient(circle at 36% 28%,#fff,#ffe2bf 62%,#ffc890);box-shadow:0 0 0 1px rgba(255,255,255,.8),0 0 40px 4px rgba(255,170,90,.4)}
.srp-timer .face b{font:400 40px/1 var(--serif);font-variant-numeric:tabular-nums}
.srp-timer .face span{max-width:110px;text-align:center;font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:#8a4a1c}
.srp-timer .ctl{display:flex;gap:8px;align-items:center}
.srp-timer .steps{grid-column:2;margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px;font-size:12.5px}
.srp-timer .steps li{padding:3px 10px;border-radius:999px;background:rgba(34,19,10,.06);color:#5b4230}
.srp-timer .steps li.now{background:#22130a;color:#fff6ec}
.srp-timer .steps li.did{text-decoration:line-through;color:#9a8676}
/* Something to read, and a picture from the bank. */
.srp-reading{display:grid;gap:4px;justify-items:start;padding:14px 18px 16px}
.srp-reading b{font:400 24px/1.15 var(--serif)}
.srp-reading .by{font:11.5px var(--mono);color:#8a6a52}
.srp-reading blockquote{margin:6px 0 4px;padding-left:12px;border-left:3px solid #e2a070;font:italic 400 16px/1.45 var(--serif);color:#3d2a1c}
.srp-reading .srp-btn{margin-top:6px;text-decoration:none}
.srp-pic{padding:12px 16px}

/* The document: every line is its own field, drawn as what it is. */
.srp-doc{display:grid;gap:1px}
.srp-line{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;column-gap:9px;padding:2px 8px;margin:0 -8px;border-radius:9px;transition:background .2s ease,box-shadow .2s ease}
.srp-line textarea{grid-column:2;display:block;width:100%;resize:none;overflow:hidden;border:0;outline:0;padding:0;margin:0;background:transparent;color:#22130a;font:15.5px/1.6 var(--sans)}
.srp-line textarea::placeholder{color:rgba(34,19,10,.3)}
.srp-line .mk{grid-column:1;min-width:18px;padding-top:1px;font:15.5px/1.6 var(--sans);color:#a6541d;text-align:right;user-select:none}
.srp-line.p .mk{display:none}
.srp-line.p textarea{grid-column:1/-1}
.srp-line.h1 textarea{font:400 27px/1.2 var(--serif);padding:4px 0 2px}
.srp-line.h2 textarea{font:400 21px/1.25 var(--serif);padding:6px 0 1px}
.srp-line.h3 textarea{font:600 13px/1.6 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:#7a4a22;padding-top:6px}
.srp-line.h1 .mk,.srp-line.h2 .mk,.srp-line.h3 .mk{display:none}
.srp-line.h1 textarea,.srp-line.h2 textarea,.srp-line.h3 textarea{grid-column:1/-1}
.srp-line.quote{border-left:3px solid #e2a070;border-radius:0 9px 9px 0;padding-left:12px;margin-left:0}
.srp-line.quote .mk{display:none}
.srp-line.quote textarea{grid-column:1/-1;font:italic 400 17px/1.45 var(--serif);color:#3d2a1c}
.srp-line .tick{grid-column:1;width:19px;height:19px;margin-top:4px;border-radius:6px;border:1.5px solid rgba(120,70,30,.45);background:#fff;display:grid;place-items:center;cursor:pointer;padding:0;color:transparent;font-size:12px;line-height:1;transition:background .15s ease,border-color .15s ease}
.srp-line .tick:hover{border-color:#b4521a}
.srp-line.done .tick{background:#1f8a52;border-color:#1f8a52;color:#fff}
.srp-line.done textarea{color:#9a8676;text-decoration:line-through}
.srp-line.dim textarea{font-size:12.5px;color:#9a8676}
.srp-line.blank:not(:focus-within):not(.here) textarea{height:9px!important}
.srp-line.here{background:linear-gradient(90deg,rgba(255,196,128,.38),rgba(255,226,196,.16));box-shadow:inset 3px 0 0 #e2661f}
.srp-line:focus-within{background:rgba(255,214,170,.22)}

/* No work yet. */
.srp-empty{flex:1;padding:22px 22px 24px;display:grid;gap:14px;align-content:start;justify-items:start;overflow:auto}
.srp-empty p{margin:0;max-width:52ch;color:#5b4230}
.srp-empty .big{font:400 24px/1.2 var(--serif);color:#22130a}
.srp-working{display:inline-flex;align-items:center;gap:9px;font:13px var(--sans);color:#7a3d14}
.srp-working i{width:9px;height:9px;border-radius:50%;background:#e2661f;animation:srp-pulse 1.4s ease-in-out infinite}
.srp .srp-btn{border:1px solid #22130a;background:#22130a;color:#fff6ec;border-radius:999px;padding:8px 16px;font:500 13px var(--sans);cursor:pointer}
.srp .srp-btn.quiet{background:rgba(255,255,255,.7);color:#22130a;border-color:rgba(60,30,10,.2)}
.srp .srp-btn:hover{filter:brightness(1.15)}
.srp .srp-btn.quiet:hover{filter:none;border-color:#e07a3a;background:#fff}

/* The side: what the Journal knows, then OpenClaw. */
.srp-side{min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:10px}
.srp-rail{min-height:0;overflow:auto;display:grid;gap:10px;align-content:start;padding-right:2px;overscroll-behavior:contain}
.srp-sec{padding:12px 14px 13px}
.srp-sec h4{margin:0 0 7px;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:#a6541d}
.srp-flag{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.9);font-size:13px;color:#3d2a1c}
.srp-flag+.srp-flag{margin-top:6px}
.srp-flag>i{width:8px;height:8px;margin-top:6px;border-radius:50%;background:#8aa0bd}
.srp-flag.warn{background:linear-gradient(180deg,rgba(255,224,190,.9),rgba(255,238,220,.7));border-color:rgba(226,102,31,.35);color:#4a2408}
.srp-flag.warn>i{background:#e2661f;box-shadow:0 0 0 3px rgba(226,102,31,.2)}
.srp-flag.gap>i{background:transparent;border:1.5px dashed #a08a78}
.srp-act{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:7px;font-size:12.5px}
.srp-act pre{flex:1 1 100%;margin:0;padding:7px 9px;border-radius:9px;background:rgba(255,255,255,.7);white-space:pre-wrap;max-height:120px;overflow:auto;font:12px/1.4 var(--sans)}
.srp-act .ok{color:#1f7a4a;font-weight:500}
.srp-act .err{color:#a3361a}
.srp-oc{margin-left:6px;font:9.5px var(--mono);letter-spacing:.04em;color:#a6541d;white-space:nowrap}
.srp-go{display:flex;align-items:baseline;gap:8px;width:100%;text-align:left;padding:9px 12px;border-radius:13px;border:1px solid rgba(180,82,26,.3);background:rgba(255,255,255,.75);color:#22130a;font:500 14px var(--sans);text-decoration:none;cursor:pointer}
.srp-go:hover{border-color:#b4521a;background:#fff}
.srp-go span{margin-left:auto;color:#b4521a}
.srp-sec p.detail{margin:6px 0 0;font-size:12.5px;color:#6a4a32}
.srp-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.srp-links a{display:inline-flex;align-items:baseline;gap:6px;max-width:100%;padding:4px 11px;border-radius:999px;background:rgba(255,255,255,.7);border:1px solid rgba(60,30,10,.14);color:#22130a;text-decoration:none;font-size:12.5px}
.srp-links a:hover{border-color:#e07a3a;background:#fff}
.srp-links a small{font:9.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:#a6541d}
.srp-links a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srp-steps{margin:0;padding:0;list-style:none;display:grid;gap:5px;font-size:13px}
.srp-steps li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px}
.srp-steps li::before{content:"";width:13px;height:13px;margin-top:3px;border-radius:4px;border:1.5px solid rgba(120,70,30,.4)}
.srp-steps li.done{color:#9a8676}
.srp-steps li.done::before{background:#1f8a52;border-color:#1f8a52}
.srp-steps a{color:#b4521a}
.srp-facts{margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:13px}
.srp-facts dt{font:11px var(--mono);color:#8a6a52;padding-top:2px}
.srp-facts dd{margin:0}
.srp-rel{margin:0;padding:0;list-style:none;display:grid;gap:4px}
.srp-rel button{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:baseline;width:100%;text-align:left;padding:5px 9px;border-radius:10px;border:0;background:transparent;cursor:pointer;font-size:13px}
.srp-rel button:hover:not(:disabled){background:rgba(255,255,255,.75)}
.srp-rel button:disabled{cursor:default}
.srp-rel i{width:8px;height:8px;border-radius:50%;border:1.5px solid #a08a78;align-self:center}
.srp-rel i.over{background:#e2661f;border-color:#e2661f}
.srp-rel i.done{background:#1f8a52;border-color:#1f8a52}
.srp-rel i.target{background:#22130a;border-color:#22130a}
.srp-rel em{font-style:normal;margin-left:6px;font:10.5px var(--mono);color:#8a6a52}
.srp-rel .d{font:11px var(--mono);color:#8a6a52;white-space:nowrap}
.srp-sec details{border-top:1px solid rgba(180,110,50,.14);padding-top:8px;margin-top:8px}
.srp-sec details:first-of-type{border-top:0;padding-top:0;margin-top:0}
.srp-sec summary{cursor:pointer;font:500 13px var(--sans);color:#3d2a1c}
.srp-md{font-size:13px;color:#3d2a1c;overflow-wrap:anywhere}
.srp-md p,.srp-md ul,.srp-md ol{margin:6px 0}
.srp-md ul,.srp-md ol{padding-left:18px}
.srp-md a{color:#b4521a}
.srp-md code{font:12px var(--mono)}
.srp-hist{margin:6px 0 0;padding:0;list-style:none;font-size:12.5px;color:#5b4230;display:grid;gap:3px}
.srp-hist span{font:11px var(--mono);color:#8a6a52;margin-right:8px}
.srp-agent{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0 4px;font:12px var(--sans);color:#7a5a42}
.srp-agent b{font-weight:600;color:#3d2a1c}
.srp-agent i{width:8px;height:8px;border-radius:50%;background:#e2661f;animation:srp-pulse 1.4s ease-in-out infinite}
.srp-agent button{margin-left:auto;border:0;background:none;color:#b4521a;cursor:pointer;font:500 12px var(--sans);padding:0}
.srp-note{margin:0;color:#7a5a42;font-size:13px}
/* The picture of the work, from the shapes bank, in daylight. */
.srp-parts{--fg:#22130a;--sub:rgba(34,19,10,.62);--accent:#b4521a;--line:rgba(60,30,10,.16);--fill:#fff;--soft:rgba(34,19,10,.08);--hot:#d2451a;--good:#1f7a4a;--good-soft:rgba(31,122,74,.13);display:grid;gap:10px;color:var(--fg);font-size:13px}
.srp-parts .p-quote{font-size:17px}
.srp-parts .p-value b{font-size:32px}

/* OpenClaw: one line to ask from, and the conversation when there is one. */
.srp-ask{display:flex;align-items:center;gap:10px;width:100%;padding:11px 14px 11px 16px;border-radius:999px;cursor:text;text-align:left;font:14px var(--sans);color:#7a5a42}
.srp-ask:hover{border-color:#e7a877}
.srp-ask i{flex:none;width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,#ffb066,#e2661f);box-shadow:0 0 0 4px rgba(226,102,31,.16)}
.srp-ask b{margin-left:auto;flex:none;width:28px;height:28px;border-radius:50%;background:#22130a;color:#fff6ec;display:grid;place-items:center;font:600 14px/1 var(--sans)}
.srp-chat{min-height:0;display:flex;flex-direction:column;overflow:hidden;--hz-ink:#22130a;--hz-dim:#7a5a42;--hz-em:#b4521a}
.srp-chat .hzc{color:#22130a}
.srp-chat .hzc-head{border-bottom-color:rgba(180,110,50,.16)}
.srp-chat .hzc-head b{color:#a6541d}
.srp-chat .hzc-head b i{background:#e2661f}
.srp-chat .hzc-acts button{color:#7a5a42;border-color:rgba(60,30,10,.2)}
.srp-chat .hzc-acts button:hover{color:#22130a;border-color:#e07a3a}
.srp-chat .hzc-m.you{background:#22130a;border-color:#22130a;color:#fff6ec}
.srp-chat .hzc-m.openclaw{background:rgba(255,255,255,.85);border-color:rgba(60,30,10,.1);color:#22130a}
.srp-chat .hzc-dots{background:rgba(255,255,255,.85);border-color:rgba(60,30,10,.1)}
.srp-chat .hzc-dots i{background:#e2661f}
.srp-chat .hzc-err{color:#a3361a}
.srp-chat .hzc-sugg button{color:#7a3d14;background:rgba(255,255,255,.7);border-color:rgba(180,82,26,.3)}
.srp-chat .hzc-sugg button:hover{border-color:#b4521a}
.srp-chat .hzc-in{background:rgba(255,255,255,.85);border-color:rgba(60,30,10,.18)}
.srp-chat .hzc-in:focus-within{border-color:#e07a3a}
.srp-chat .hzc-send{background:#22130a;color:#fff6ec}
.srp-chat .hzc-foot a:hover{color:#b4521a}
@keyframes srp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.82)}}
@media (prefers-reduced-motion:reduce){.srp-jump .dot,.srp-working i,.srp-agent i{animation:none}}

/* A narrow screen: one column, and the whole sheet scrolls. */
.narrow .srp{display:block;overflow:auto;padding:14px 12px 16px}
.narrow .srp-head{display:flex;flex-direction:column;align-items:stretch}
.narrow .srp-acts{order:-1;align-self:flex-end;margin-bottom:6px}
.narrow .srp-body{grid-template-columns:minmax(0,1fr);margin-top:12px}
.narrow .srp-work{overflow:visible}
.narrow .srp-side{grid-template-rows:auto auto}
.narrow .srp-rail{overflow:visible}
.narrow .srp-chat{height:420px}
.narrow .srp-jump{flex-wrap:wrap}
.narrow .srp-fields label{grid-template-columns:minmax(0,1fr)}
.narrow .srp-timer{grid-template-columns:minmax(0,1fr);justify-items:center}
.narrow .srp-timer .face{grid-row:auto}
.narrow .srp-timer .steps{grid-column:1;justify-content:center}
`;

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const dayFrom = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isInternal = (href: string) => href.startsWith('/');
const outLink = (href: string) => (isInternal(href) ? {} : { target: '_blank', rel: 'noopener noreferrer' });
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

  // Every field is as tall as its words.
  React.useLayoutEffect(() => {
    fields.current.forEach((el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } });
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
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollIntoView({ block: 'nearest' });
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
    <div className="srp-doc">
      {lines.map((line, index) => {
        const kind = lineKind(line.mark);
        return (
          <div key={index} className={`srp-line ${kind}${index === here ? ' here' : ''}${isAside(line.text) ? ' dim' : ''}${kind === 'p' && line.text === '' && lines.length > 1 ? ' blank' : ''}`}>
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
          </div>
        );
      })}
    </div>
  );
}

/** The picture of the work from the task's form, drawn by the shapes bank. */
function Picture({ parts }: { parts: Part[] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren(...parts.map((part) => renderPart(part, 2)));
    return () => host.replaceChildren();
  }, [parts]);
  return <div ref={ref} className="srp-parts" />;
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

/** One block of the work, drawn as what it is. `lead` is the block to jump into: it is lit and takes the caret. */
function BlockView({ block, href, lead, focusJump, onChange }: {
  block: WorkBlock; href: string | null; lead: boolean; focusJump: boolean; onChange: (block: WorkBlock) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  switch (block.kind) {
    case 'doc':
    case 'checklist':
      return (
        <div className="srp-block srp-sheet">
          {block.label && <span className="srp-lab">{block.label}</span>}
          <Doc value={block.body} onChange={(body) => onChange({ ...block, body })} focusJump={lead && focusJump} lit={lead} />
        </div>
      );
    case 'letter':
      return (
        <div className="srp-block srp-sheet srp-letter">
          <label><span>To</span><input value={block.to} onChange={(e) => onChange({ ...block, to: e.target.value })} aria-label="To" /></label>
          <label><span>Subject</span><input value={block.subject} onChange={(e) => onChange({ ...block, subject: e.target.value })} aria-label="Subject" /></label>
          <Doc value={block.body} onChange={(body) => onChange({ ...block, body })} focusJump={lead && focusJump} lit={lead} />
          <div className="srp-under">
            <button type="button" className="srp-btn" onClick={() => { void navigator.clipboard?.writeText(block.body).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }}>{copied ? 'Copied' : 'Copy the message'}</button>
            {href && <a href={href} target="_blank" rel="noopener noreferrer">Open the thread ↗</a>}
            <span>OpenClaw drafts. Sending is yours.</span>
          </div>
        </div>
      );
    case 'problem':
      return (
        <div className="srp-block srp-sheet srp-problem">
          {block.label && <span className="srp-lab">{block.label}</span>}
          <p className="prompt">{block.prompt}</p>
          {block.given && <pre>{block.given}</pre>}
          <span className="srp-lab">Your work</span>
          <Doc value={block.work} onChange={(work) => onChange({ ...block, work })} focusJump={lead && focusJump} lit={lead} />
        </div>
      );
    case 'fields': {
      const filled = block.items.filter((f) => f.value.trim() !== '').length;
      return (
        <div className="srp-block srp-sheet srp-fields">
          <span className="srp-lab">{block.label ?? 'The form'}<em>{filled} of {block.items.length} filled</em></span>
          {block.items.map((field, i) => (
            <label key={i} className={field.needs && field.value.trim() === '' ? 'needs' : undefined}>
              <span>{field.label}</span>
              <input
                value={field.value}
                placeholder={field.needs ? field.hint ?? 'Needs you' : ''}
                onChange={(e) => onChange({ ...block, items: block.items.map((f, j) => (j === i ? { ...f, value: e.target.value } : f)) })}
              />
              {field.needs && field.value.trim() === '' && <i>needs you</i>}
            </label>
          ))}
          {href && <div className="srp-under"><a href={href} target="_blank" rel="noopener noreferrer">Open the real form ↗</a><span>Nothing is submitted from here.</span></div>}
        </div>
      );
    }
    case 'choices':
      return (
        <div className="srp-block srp-choices">
          <p className="prompt">{block.prompt}</p>
          <div className="opts">
            {block.options.map((option, i) => (
              <button key={i} type="button" className={`srp-glass${block.picked === i ? ' on' : ''}`} aria-pressed={block.picked === i}
                onClick={() => onChange({ ...block, ...(block.picked === i ? { picked: undefined } : { picked: i }) })}>
                <b>{option.title}</b>
                {option.detail && <span>{option.detail}</span>}
                {option.points && <ul>{option.points.map((point, j) => <li key={j}>{point}</li>)}</ul>}
                <em>{block.picked === i ? 'Picked' : 'Pick this'}</em>
              </button>
            ))}
          </div>
        </div>
      );
    case 'slides': {
      const slide = block.items[block.at] ?? block.items[0];
      const set = (patch: Partial<typeof slide>) => onChange({ ...block, items: block.items.map((s, j) => (j === block.at ? { ...s, ...patch } : s)) });
      return (
        <div className="srp-block srp-slides">
          <div className="strip">
            {block.items.map((s, i) => (
              <button key={i} type="button" className={i === block.at ? 'on' : undefined} onClick={() => onChange({ ...block, at: i })}>
                <small>{i + 1}</small><span>{s.title}</span>
              </button>
            ))}
          </div>
          <div className="srp-sheet slide">
            <input className="ttl" value={slide.title} onChange={(e) => set({ title: e.target.value })} aria-label="Slide title" />
            <Doc key={block.at} value={slide.body ?? ''} onChange={(body) => set({ body })} focusJump={lead && focusJump} lit={false} />
            <label className="notes"><span>Speaker notes</span>
              <textarea rows={2} value={slide.notes ?? ''} placeholder="What you will say" onChange={(e) => set({ notes: e.target.value })} />
            </label>
          </div>
        </div>
      );
    }
    case 'timer':
      return <div className="srp-block srp-sheet"><TimerBlock block={block} /></div>;
    case 'reading':
      return (
        <div className="srp-block srp-reading srp-glass">
          <span className="srp-lab">To read</span>
          <b>{block.title}</b>
          {block.by && <span className="by">{block.by}</span>}
          {block.excerpt && <blockquote>{block.excerpt}</blockquote>}
          {block.href && <a className="srp-btn" href={block.href} target="_blank" rel="noopener noreferrer">Open it ↗</a>}
        </div>
      );
    case 'part':
      return <div className="srp-block srp-glass srp-pic"><Picture parts={[block.part]} /></div>;
  }
}

/** The started work: the step to take now, then its blocks, which save themselves as he works in them. */
function WorkCard({ taskId, work, next, focusJump, onWork }: {
  taskId: string; work: ResolvedWork; next: string; focusJump: boolean; onWork: (work: ResolvedWork | null) => void;
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
  const status = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved in the Journal' : state === 'failed' ? 'Not saved yet. Keep going to retry.' : edited ? 'Yours, saved in the Journal' : 'Started by OpenClaw';
  // The block to jump into is the first one he acts in; what comes before it is context.
  const lead = blocks.findIndex(isActive);

  return (
    <section className="srp-work" aria-label="The work, started">
      {blocks.map((block, index) => (
        <React.Fragment key={block.id}>
          {index === Math.max(0, lead) && (
            <div className="srp-jump srp-glass">
              <i className="dot" aria-hidden="true" />
              <div>
                <span className="lab">Jump in here</span>
                <b>{next || work.title}</b>
              </div>
              <div className="right">
                <span role="status">{status}</span>
                {work.href && <a href={work.href} target="_blank" rel="noopener noreferrer">Finish it there ↗</a>}
              </div>
            </div>
          )}
          <BlockView block={block} href={work.href} lead={index === lead} focusJump={focusJump} onChange={change} />
        </React.Fragment>
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

/** What the Journal knows about the task, in the order it is needed. Nothing is drawn for what it does not know. */
function Rail({ brief, parts, onGoto, onRefresh, onActionDone }: {
  brief: TaskBrief; parts: Part[]; onGoto: (id: string) => void; onRefresh: () => void; onActionDone: (id: string) => void;
}) {
  const order = { warn: 0, info: 1, gap: 2 } as const;
  const flags = brief.flags.slice().sort((a, b) => order[a.level] - order[b.level]);
  const n = brief.next;
  const links = brief.links.filter((l) => l.href !== n?.href);
  const go = (r: BriefRelated) => { if (r.state !== 'target' && r.state !== 'done') onGoto(r.taskId); };
  const a = brief.agent;
  const working = a?.status === 'queued' || a?.status === 'running';
  return (
    <div className="srp-rail">
      {flags.length > 0 && (
        <div>
          {flags.map((f, i) => (
            <div key={i} className={`srp-flag ${f.level}`}>
              <i aria-hidden="true" />
              <div>
                {f.text}<Oc item={f} />
                {f.action && <Fix action={f.action} brief={brief} onDone={onActionDone} />}
              </div>
            </div>
          ))}
        </div>
      )}
      {parts.length > 0 && (
        <section className="srp-sec srp-glass">
          <h4>At a glance</h4>
          <Picture parts={parts} />
        </section>
      )}
      {(n?.href || n?.taskId || links.length > 0) && (
        <section className="srp-sec srp-glass">
          <h4>Where it gets done</h4>
          {n?.href ? <a className="srp-go" href={n.href} {...outLink(n.href)}>{n.label}<span>↗</span></a>
            : n?.taskId ? <button type="button" className="srp-go" onClick={() => onGoto(n.taskId as string)}>{n.label}<span>→</span></button> : null}
          {n?.detail && (n.href || n.taskId) && <p className="detail">{n.detail}<Oc item={n} /></p>}
          {links.length > 0 && (
            <div className="srp-links">
              {links.map((l) => (
                <a key={l.href} href={l.href} title={l.label} {...outLink(l.href)}><small>{l.kind === 'app' ? 'journal' : l.kind}</small><span>{l.label}</span></a>
              ))}
            </div>
          )}
        </section>
      )}
      {brief.steps.length > 0 && (
        <section className="srp-sec srp-glass">
          <h4>Steps</h4>
          <ul className="srp-steps">
            {brief.steps.map((s, i) => (
              <li key={i} className={s.done ? 'done' : undefined}>
                <span>{s.href ? <a href={s.href} {...outLink(s.href)}>{s.text}</a> : s.text}<Oc item={s} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {brief.related.length > 0 && (
        <section className="srp-sec srp-glass">
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
      {brief.facts.length > 0 && (
        <section className="srp-sec srp-glass">
          <h4>Facts</h4>
          <dl className="srp-facts">
            {brief.facts.map((f, i) => <React.Fragment key={i}><dt>{f.k}</dt><dd>{f.v}<Oc item={f} /></dd></React.Fragment>)}
          </dl>
        </section>
      )}
      {(brief.sections.length > 0 || brief.history.length > 0) && (
        <section className="srp-sec srp-glass">
          {brief.sections.map((s) => (
            <details key={s.title}>
              <summary>{s.title}<Oc item={s} /></summary>
              <div className="srp-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, ...props }) => <a href={href} {...props} {...(href ? outLink(href) : {})} /> }}>{s.markdown}</ReactMarkdown>
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
      {a && (
        <div className="srp-agent" role="status">
          {working && <i aria-hidden="true" />}
          <b>OpenClaw</b>
          {a.status === 'running' && <span>is reading Canvas, email and your journal for this…</span>}
          {a.status === 'queued' && <span>will look at this shortly.</span>}
          {a.status === 'done' && <span>{a.summary ? `${a.summary} · ` : 'looked '}{ago(a.finishedAt)}</span>}
          {a.status === 'failed' && <span>couldn’t look at this{a.error ? `: ${a.error}` : '.'}</span>}
          {!working && <button type="button" onClick={onRefresh}>{a.status === 'failed' ? 'Retry' : 'Look again'}</button>}
        </div>
      )}
    </div>
  );
}

// ───────────── the pane ─────────────

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
  const [chat, setChat] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const eyebrow = React.useRef<HTMLSpanElement>(null);

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
  }, [icon]);

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
    if (json?.success) setWork((json.data as ResolvedWork | null) ?? { title: short, href: null, blocks, edited: true, baseHash: null, newer: null, startedAt: null });
  };
  const actionDone = (actionId: string) => {
    void post('/api/tasks/brief-agent', { action: 'action-done', taskId, actionId }).then(() => { onChanged(); loadBrief(); });
  };
  // On a wide sheet the caret goes straight to the place to pick up from; on a phone that would raise the keyboard.
  const focusJump = typeof window !== 'undefined' && window.innerWidth >= 700;

  return (
    <div className="srp">
      <header className="srp-head">
        <span className="srp-eyebrow" ref={eyebrow}>
          <span>{form?.kind}</span>
          {due && <span className={`srp-due${zone === 'hold' ? ' over' : zone === 'ignition' ? ' soon' : ''}`}>{due}</span>}
          {when?.where && <span className="srp-where">{when.where}</span>}
        </span>
        <h2>{form?.name ?? title}</h2>
        {form?.what && <p className="srp-what">{form.what}</p>}
        <div className="srp-acts">
          <button type="button" onClick={() => onLetGo({ id: taskId, listType, short, title })} disabled={busy}
            title="No longer worth doing. Takes it off your lists without counting it as done.">Let go</button>
          <button type="button" className="doneb" onClick={() => void done()} disabled={busy}>{busy ? 'Saving…' : 'Done'}</button>
          <button type="button" className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {form && form.did.length > 0 && (
          <div className="srp-did"><span>OpenClaw already</span>{form.did.map((d) => <i key={d}>{d}</i>)}</div>
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
        {error && <p className="srp-err" role="alert">{error}</p>}
      </header>
      <div className="srp-body">
        {work ? (
          <WorkCard key={`${work.baseHash}|${work.edited}`} taskId={taskId} work={work} next={next} focusJump={focusJump} onWork={setWork} />
        ) : (
          <section className="srp-work" aria-label="The work">
            <div className="srp-jump srp-glass">
              <i className="dot" aria-hidden="true" />
              <div><span className="lab">{next ? 'Start here' : 'Not started yet'}</span><b>{next || short}</b></div>
            </div>
            <div className="srp-empty srp-glass">
              {work === undefined ? <p>Opening…</p> : filling ? (
                <>
                  <p className="big">OpenClaw is getting this ready.</p>
                  <span className="srp-working"><i aria-hidden="true" />Reading what it can reach and starting the first piece. It will appear here.</span>
                </>
              ) : (
                <>
                  <p className="big">Nothing is started here yet.</p>
                  <p>OpenClaw works through your tasks one at a time, soonest first. You can send it to this one now, or start it yourself{brief && brief.steps.length > 0 ? ` from its ${brief.steps.length} step${brief.steps.length === 1 ? '' : 's'}` : ''}.</p>
                </>
              )}
              {work === null && (
                <>
                  {!filling && <button type="button" className="srp-btn" onClick={() => void refresh()}>Have OpenClaw start it now</button>}
                  <button type="button" className="srp-btn quiet" onClick={() => void startOwn()}>Start it yourself here</button>
                </>
              )}
              <p style={{ fontSize: 12 }}>Everything written here stays in the Journal.</p>
            </div>
          </section>
        )}
        <aside className="srp-side" aria-label="What the Journal knows, and OpenClaw">
          {chat ? (
            <div className="srp-chat srp-glass" style={{ gridRow: '1 / -1' }}>
              <BriefChat key={taskId} taskId={taskId} title={short} onClose={() => setChat(false)} />
            </div>
          ) : (
            <>
              {brief ? <Rail brief={brief} parts={parts} onGoto={onGoto} onRefresh={() => void refresh()} onActionDone={actionDone} />
                : <div className="srp-rail"><p className="srp-note">{brief === undefined ? 'Gathering what the Journal knows…' : 'Could not load what the Journal knows about this task.'}</p></div>}
              <button type="button" className="srp-ask srp-glass" onClick={() => setChat(true)}>
                <i aria-hidden="true" />Ask OpenClaw, or tell it what to do next…<b aria-hidden="true">↑</b>
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
