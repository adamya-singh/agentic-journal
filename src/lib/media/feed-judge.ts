import { generateObject } from 'ai';
import { vertex } from '@ai-sdk/google-vertex';
import { z } from 'zod';
import { DEFAULT_VOCABULARY, type CompassKind } from './feed-types.ts';
import type { Compass } from './compass.ts';
import type { JudgeInput } from './feed-pools.ts';

// Asks Gemini (through the Journal's Vertex setup, like capture classification)
// whether each item would pretrain Adamya toward his compass. Used by the seed
// pass and by `media.ts feed-judge`; OpenClaw can also judge items itself.

export const JUDGE_MODEL = () => process.env.FEED_JUDGE_MODEL || 'gemini-2.5-flash';
export const Verdict = z.object({
  id: z.string(),
  aligned: z.boolean(),
  confidence: z.number(),
  tags: z.array(z.string()),
  why: z.string(),
});
export type Verdict = z.infer<typeof Verdict>;
const Verdicts = z.object({ verdicts: z.array(Verdict) });

export function judgePrompt(compass: Compass, vocabulary: string[], items: JudgeInput[]) {
  const vocab = vocabulary
    .map((t) => `- ${t}${DEFAULT_VOCABULARY[t] ? `: ${DEFAULT_VOCABULARY[t]}` : ''}`)
    .join('\n');
  const period =
    compass.kind === 'short' && compass.period
      ? `\nThis short-term compass covers ${[compass.period.start, compass.period.end].filter(Boolean).join(' to ') || compass.period.label}.`
      : '';
  return `You curate Adamya's personal feed. He believes everything he watches and reads is pretraining for his mind, so this feed must only hold content that shapes him into the person his compass describes. You judge items from his own YouTube watch history, his saved X bookmarks and his IMDb recommendations.

His ${compass.kind === 'short' ? 'SHORT-TERM' : 'LONG-TERM'} compass:${period}
"""
${compass.text.slice(0, 6000)}
"""${compass.forAgents ? `\n\nOpenClaw's rules for this period (use them when judging):\n${compass.forAgents.slice(0, 2000)}` : ''}

What counts as aligned:
- Builds the capabilities the compass names: frontier AI understanding, ML fundamentals from scratch, research papers, building and shipping, founder and strategy thinking, compute and leverage, great engineers and researchers talking shop.
- Builds character: discipline, courage, ambition, focus, good advice that would change a decision, health and energy for high output.
- Raises taste: design and craft, aesthetics, stories of persistence and excellence. Films are aligned only when they inspire grit, ambition or excellence, not merely because they are popular.
- A modest amount of tech news is aligned (he follows TBPN, Fireship), but a news recap is never above 0.6 confidence.
Not aligned: memes and jokes with nothing to take away, music videos, sound effects, gaming, celebrity, outrage politics, culture-war fights, clickbait, generic motivation slop, product unboxings with no insight, anything that is pure stimulation.

Confidence (0 to 1): 0.9+ = directly makes him the person in the compass (e.g. Karpathy building a model from scratch, a frontier lab leader on strategy, a founder's hard-won lesson). 0.7 = clearly worth his time. 0.5 = loosely aligned. Below 0.45 set aligned=false.

Tags: 1 to 3 from this vocabulary, exact spelling. Only if none fits, one new short lowercase tag.
${vocab}

why: ONE sentence, at most 140 characters. Lead with what the item concretely says, shows or teaches, then the part of him it builds. Never use the words "align", "aligns", "compass", "mission", "this video" or "this post". Examples:
- "Karpathy rebuilds a language model from zero, the fundamentals-as-muscle-memory you asked for."
- "Dylan Patel maps who controls compute and why that decides which labs win."
- "A blunt case for guarding your attention like capital."
For items that are not aligned, give the reason in a few words.

Items (id | source | creator | title | details):
${items.map((i) => `${i.id} | ${i.source} | ${i.creator} | ${i.title || '-'} | ${i.detail}`).join('\n')}

Return one verdict per item, same ids.`;
}

export async function judgeBatch(
  compass: Compass,
  vocabulary: string[],
  items: JudgeInput[],
): Promise<Verdict[]> {
  if (process.env.FEED_LLM_DISABLED === '1') throw new Error('The feed judge is disabled (FEED_LLM_DISABLED=1).');
  if (!items.length) return [];
  const { object } = await generateObject({
    model: vertex(JUDGE_MODEL()),
    schema: Verdicts,
    prompt: judgePrompt(compass, vocabulary, items),
    maxOutputTokens: 120 * items.length + 500,
    abortSignal: AbortSignal.timeout(120_000),
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });
  const ids = new Set(items.map((i) => i.id));
  const vocab = new Set(vocabulary);
  return object.verdicts
    .filter((v) => ids.has(v.id))
    .map((v) => ({
      ...v,
      confidence: Math.max(0, Math.min(1, v.confidence)),
      aligned: v.aligned && v.confidence >= 0.45,
      // Keep vocabulary tags, plus at most one new one.
      tags: [
        ...v.tags.filter((t) => vocab.has(t)),
        ...v.tags.filter((t) => !vocab.has(t)).slice(0, 1).map((t) => t.toLowerCase().slice(0, 30)),
      ].slice(0, 3),
      why: v.why.trim().slice(0, 220),
    }));
}

export const judgedBy = (kind: CompassKind) => `${JUDGE_MODEL()}:${kind}`;
