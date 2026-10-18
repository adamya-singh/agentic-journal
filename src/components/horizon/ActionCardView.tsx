'use client';

// The far side's card: what it is, why act, the next step, and a decision that always carries a reason.
import React from 'react';
import type { ActionCard, CardOutcome, CardSource, OutcomeKind } from '@/lib/action-cards/types';

export const SRC_NAME: Record<CardSource, string> = { x: 'X', jobs: 'Jobs', inbox: 'Inbox', compass: 'Compass', tasks: 'Tasks', other: 'Journal' };
export const SRC_ICON: Record<CardSource, string> = {
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>',
  jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/></svg>',
  other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/></svg>',
};
// Reasons that mean "later", not "no": the card snoozes instead of going away.
export const SNOOZE_RE = /^(not now|not this week|not before|not until|parked|too long|later|after )/i;

export const CARD_CSS = `
.ac{position:absolute;z-index:3;top:14px;width:min(410px,46%);max-height:calc(100% - 28px);overflow:auto;overscroll-behavior:contain;border-radius:20px;background:linear-gradient(180deg,rgba(22,27,48,.86),rgba(9,12,24,.93));backdrop-filter:blur(22px) saturate(1.3);-webkit-backdrop-filter:blur(22px) saturate(1.3);border:1px solid rgba(255,255,255,.12);box-shadow:0 40px 90px -20px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.08);color:var(--hz-ink);font:13.5px/1.5 var(--hz-sans);pointer-events:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
.ac.r{right:14px}.ac.l{left:14px}
.ac.oc{border-color:rgba(134,230,216,.24)}
.ac-m{position:relative;height:140px;background-size:cover;background-position:center;border-radius:20px 20px 0 0}
.ac-m::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(9,12,24,0) 30%,rgba(16,20,38,.96))}
.ac-m.none{height:88px;background:radial-gradient(120% 140% at 85% 120%,var(--c1) 0,var(--c2) 35%,transparent 70%),linear-gradient(160deg,#141a33,#0b0f1d)}
.ac-b{padding:0 20px 20px;margin-top:-32px;position:relative;display:grid;gap:13px}
.ac-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ac-kind{font:600 10.5px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:#1b0d05;background:#ffd2a8;border-radius:6px;padding:3px 8px}
.ac.oc .ac-kind{background:#86e6d8;color:#06231f}
.ac-meta{font:11px var(--hz-mono);color:#c3cbd8}
.ac-meta.oc{color:#86e6d8}
.ac-x{margin-left:auto;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.15);cursor:pointer;color:#dfe5ee;font-size:16px;line-height:1}
.ac-x:hover,.ac-x:focus-visible{border-color:#ffd2a8;outline:none}
.ac-t{font:italic 400 30px/1.03 var(--hz-serif);margin:0;text-wrap:balance}
.ac-src{display:flex;gap:10px;align-items:center;font-size:13px}
.ac-src img,.ac-src .av{width:32px;height:32px;border-radius:50%;flex:none;object-fit:cover;background:#26304a}
.ac-src div{min-width:0;flex:1}
.ac-src b{font-weight:600}
.ac-src span{color:var(--hz-dim)}
.ac-src a{font-size:12.5px;text-decoration:none;white-space:nowrap;color:#ffd2a8}
.ac-q{margin:0;padding:2px 0 2px 14px;border-left:2px solid rgba(255,210,168,.35);font-size:13.5px;line-height:1.5;color:#c9d1dd;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}
.ac-ev{list-style:none;margin:0;padding:0;display:grid;gap:7px}
.ac-ev li{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;font-size:13.5px;line-height:1.45;color:#d9e0ea}
.ac-tag{display:inline-flex;align-items:center;gap:5px;font:500 10px var(--hz-mono);letter-spacing:.1em;text-transform:uppercase;color:#86e6d8;border:1px solid rgba(134,230,216,.35);border-radius:6px;padding:2px 7px;margin-top:1px;white-space:nowrap}
.ac-tag svg{width:11px;height:11px}
.ac-where{display:flex;gap:8px;align-items:center;font-size:12.5px;color:#cfc4ff}
.ac-where i{width:7px;height:7px;border-radius:50%;background:#cfc4ff;box-shadow:0 0 10px #cfc4ff;flex:none}
.ac-lab{font:500 10px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:#8d98aa;margin-bottom:5px}
.ac-b p{margin:0;font-size:14px;line-height:1.55;color:#e1e6ee}
.ac-b p a{color:#ffd2a8}
.ac-fit{display:inline-flex;align-items:center;gap:6px;font:500 11.5px var(--hz-sans);border-radius:999px;padding:2px 10px;border:1px solid;margin-bottom:7px}
.ac-fit.bet{color:#8fd6bf;border-color:rgba(143,214,191,.45);background:rgba(143,214,191,.08)}
.ac-fit.park{color:#e8b77a;border-color:rgba(232,183,122,.45);background:rgba(232,183,122,.08)}
.ac-fit::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.ac-next{display:flex;gap:12px;align-items:center;font-size:14px}
.ac-next i{width:10px;height:10px;border-radius:50%;background:radial-gradient(circle,#fff6d8,#ff9a3c);box-shadow:0 0 12px 3px rgba(255,154,60,.5);flex:none}
.ac-next span{flex:1;min-width:0}
.ac-next em{font:12px var(--hz-mono);font-style:normal;color:#ffd2a8;white-space:nowrap}
.ac-ask{padding:10px 12px;border-radius:14px;border:1px dashed rgba(207,196,255,.45);background:rgba(207,196,255,.05);font-size:13.5px}
.ac-dec{display:grid;gap:10px;padding-top:15px;border-top:1px solid rgba(255,255,255,.08)}
.ac-dq{display:flex;justify-content:space-between;align-items:baseline;font:500 10px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:#8d98aa}
.ac-dq b{font:italic 400 19px var(--hz-serif);letter-spacing:0;text-transform:none;color:var(--hz-ink)}
.ac-db{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ac-db button{display:flex;align-items:center;justify-content:center;gap:8px;height:44px;border-radius:13px;font:600 14.5px var(--hz-sans);cursor:pointer}
.ac-db .y{border:0;color:#1b0d05;background:linear-gradient(180deg,#ffd9a0,#ff9a3c);box-shadow:0 10px 30px -10px rgba(255,140,50,.75),inset 0 1px 0 rgba(255,255,255,.6)}
.ac-db .n{color:#e6ebf2;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.2)}
.ac-db.chosen button[aria-pressed=false]{opacity:.38}
.ac-db .y[aria-pressed=true]{box-shadow:0 0 0 2px #ffe2bd,0 10px 30px -8px rgba(255,140,50,.9)}
.ac-db .n[aria-pressed=true]{border-color:#fff;background:rgba(255,255,255,.1)}
.ac-db button:focus-visible{outline:2px solid #ffd2a8;outline-offset:2px}
.ac-why{display:grid;gap:10px}
.ac-why .q{font-size:13px;color:#c9d1dd}
.ac-why .q b{color:var(--hz-ink);font-weight:600}
.ac-rs{display:flex;flex-wrap:wrap;gap:6px}
.ac-rs button{font:500 12.5px var(--hz-sans);color:#dfe5ee;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:5px 11px;cursor:pointer}
.ac-rs button[aria-pressed=true]{background:var(--hz-ink);color:#141a30;border-color:var(--hz-ink)}
.ac-rs button.snz::before{content:"◷ ";opacity:.7}
.ac-why input[type=text]{width:100%;box-sizing:border-box;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.13);border-radius:10px;padding:9px 12px;color:var(--hz-ink);font:13.5px var(--hz-sans)}
.ac-why input[type=text]:focus{outline:none;border-color:rgba(255,210,168,.6)}
.ac-outs{display:grid;gap:6px}
.ac-outs label{display:flex;gap:10px;align-items:center;padding:8px 12px;border-radius:11px;border:1px solid rgba(255,255,255,.13);cursor:pointer;font-size:13.5px}
.ac-outs label .ol{flex:1;min-width:0}
.ac-outs label small{flex:none;max-width:45%;text-align:right;font:11px/1.3 var(--hz-mono);color:var(--hz-dim)}
.ac-outs input{accent-color:#ff9a3c;margin:0}
.ac-outs label:has(input:checked){border-color:rgba(255,210,168,.55);background:rgba(255,180,110,.07)}
.ac-ok{height:42px;border-radius:12px;font:600 14px var(--hz-sans);cursor:pointer;border:0;color:#1b0d05;background:var(--hz-ink)}
.ac-ok.dis{color:#fff;background:rgba(255,255,255,.14)}
.ac-ok:disabled{opacity:.35;cursor:not-allowed}
.ac-learn{font:12px var(--hz-sans);color:#8d98aa;text-align:center}
.ac-learn i{font-style:normal;color:#86e6d8}
.ac-err{font:12.5px var(--hz-sans);color:#ff8a5c}
@media (max-width:760px){.ac{position:fixed;left:0!important;right:0!important;top:auto;bottom:0;width:100%;max-height:86vh;border-radius:20px 20px 0 0}}
`;

const CHECK = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const Icon = ({ html }: { html: string }) => <span aria-hidden="true" style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: html }} />;

export interface CardDecisionInput { verdict: 'agree' | 'dismiss'; reason: string; outcome?: OutcomeKind; snooze?: boolean }

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export function ActionCardView({ card, where, side, onClose, onDecide }: {
  card: ActionCard;
  where: string;
  side: 'l' | 'r';
  onClose: () => void;
  onDecide: (d: CardDecisionInput) => Promise<string | void>;
}) {
  const [verdict, setVerdict] = React.useState<'agree' | 'dismiss' | null>(null);
  const [chip, setChip] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState('');
  const [out, setOut] = React.useState<OutcomeKind>(card.outcomes[0].kind);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const bottom = React.useRef<HTMLDivElement>(null);
  const oc = card.source !== 'x';
  const reason = typed.trim() || chip || '';
  const outcome: CardOutcome | undefined = card.outcomes.find((o) => o.kind === out);
  const snooze = verdict === 'dismiss' && SNOOZE_RE.test(reason);

  React.useEffect(() => { if (verdict) bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [verdict]);

  const pick = (v: 'agree' | 'dismiss') => { setVerdict(v); setChip(null); setTyped(''); setError(null); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verdict || !reason || busy) return;
    setBusy(true); setError(null);
    try {
      const err = await onDecide({ verdict, reason, ...(verdict === 'agree' ? { outcome: out } : { snooze }) });
      if (err) setError(err);
    } catch (x) {
      setError(x instanceof Error ? x.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  };
  const confirmLabel = verdict === 'agree'
    ? (outcome?.kind === 'task' ? `Agree · task${outcome.detail ? ` on ${outcome.detail}` : ''}` : outcome?.kind === 'hand' ? 'Agree · hand to OpenClaw' : `Agree · ${outcome?.label.toLowerCase() ?? ''}`)
    : snooze ? `Dismiss for now${card.snoozeUntil ? ` · ask again ${fmtDate(card.snoozeUntil + 'T12:00:00')}` : ''}` : 'Dismiss';
  const rs = verdict === 'agree' ? card.reasons.agree : card.reasons.dismiss;
  const tone = card.why.tone === 'bet';

  return (
    <article className={`ac ${side}${oc ? ' oc' : ''}`} role="dialog" aria-label={`Action card: ${card.title}`}>
      {card.post?.image
        ? <div className="ac-m" style={{ backgroundImage: `url(${card.post.image})` }} />
        : <div className="ac-m none" style={{ ['--c1' as string]: oc ? '#3fc9b4' : tone ? '#ff9a3c' : '#8f7bff', ['--c2' as string]: oc ? '#163a5a' : tone ? '#6b2a3e' : '#2c2466' }} />}
      <div className="ac-b">
        <div className="ac-h">
          <span className="ac-kind">{card.kind}</span>
          {oc ? <span className="ac-meta oc">OpenClaw noticed · {SRC_NAME[card.source]}</span> : <span className="ac-meta">From your Openclaw folder</span>}
          <button type="button" className="ac-x" onClick={onClose} aria-label="Close card">×</button>
        </div>
        <h3 className="ac-t">{card.title}</h3>
        {card.post ? (
          <>
            <div className="ac-src">
              {card.post.avatar ? <img src={card.post.avatar} alt="" /> : <span className="av" />}
              <div><b>{card.post.author}</b> <span>@{card.post.handle}{card.post.publishedAt ? ` · ${fmtDate(card.post.publishedAt)}` : ''}</span></div>
              <a href={card.post.url} target="_blank" rel="noopener noreferrer">Open on X ↗</a>
            </div>
            {card.post.text && <blockquote className="ac-q">{card.post.text.replace(/https:\/\/t\.co\/\S+/g, '').trim()}</blockquote>}
          </>
        ) : card.evidence.length > 0 && (
          <div>
            <div className="ac-lab">What OpenClaw saw</div>
            <ul className="ac-ev">
              {card.evidence.map((e, i) => (
                <li key={i}><span className="ac-tag"><Icon html={SRC_ICON[e.source]} />{SRC_NAME[e.source]}</span><span>{e.text}</span></li>
              ))}
            </ul>
          </div>
        )}
        <div className="ac-where"><i />{where}</div>
        <div><div className="ac-lab">What it is</div><p>{card.what}{card.link && <> <a href={card.link} target="_blank" rel="noopener noreferrer">{host(card.link)} ↗</a></>}</p></div>
        <div><div className="ac-lab">Why act</div><span className={`ac-fit ${card.why.tone}`}>{card.why.label}</span><p>{card.why.text}</p></div>
        <div className="ac-next"><i /><span>{card.next}</span><em>{card.estimate}</em></div>
        {card.ask && <div className="ac-ask">OpenClaw asks: {card.ask}</div>}
        <form className="ac-dec" onSubmit={submit}>
          <div className="ac-dq"><b>Act on this?</b>{card.status === 'handed' ? 'OpenClaw is on it' : 'Pick one, then say why'}</div>
          <div className={`ac-db${verdict ? ' chosen' : ''}`}>
            <button type="button" className="y" aria-pressed={verdict === 'agree'} onClick={() => pick('agree')}><Icon html={CHECK} />Agree</button>
            <button type="button" className="n" aria-pressed={verdict === 'dismiss'} onClick={() => pick('dismiss')}><Icon html={CROSS} />Dismiss</button>
          </div>
          {verdict && (
            <div className="ac-why">
              <div className="q"><b>{verdict === 'agree' ? 'Why agree?' : 'Why dismiss?'}</b> Tap one or write your own.</div>
              <div className="ac-rs">
                {rs.map((r) => (
                  <button key={r} type="button" className={verdict === 'dismiss' && SNOOZE_RE.test(r) ? 'snz' : undefined} aria-pressed={chip === r} onClick={() => setChip((c) => (c === r ? null : r))}>{r}</button>
                ))}
              </div>
              <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="In your own words" aria-label="Your reason" />
              {verdict === 'agree' && (
                <div className="ac-outs" role="radiogroup" aria-label="What agreeing does">
                  {card.outcomes.map((o) => (
                    <label key={o.kind}><input type="radio" name={`out-${card.id}`} checked={out === o.kind} onChange={() => setOut(o.kind)} /><span className="ol">{o.label}</span>{o.detail && <small>{o.detail}</small>}</label>
                  ))}
                </div>
              )}
              <button type="submit" className={`ac-ok${verdict === 'agree' ? '' : ' dis'}`} disabled={!reason || busy}>{busy ? 'Saving…' : confirmLabel}</button>
              {error && <div className="ac-err" role="alert">{error}</div>}
              <div className="ac-learn">OpenClaw keeps your reason and {verdict === 'agree' ? <i>learns what you go for</i> : <i>writes fewer cards like this</i>}.</div>
            </div>
          )}
          <div ref={bottom} />
        </form>
      </div>
    </article>
  );
}
