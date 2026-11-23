// Asks OpenClaw to judge wide-net postings (src/lib/job-wide-net-judge.ts): eight to a turn, one turn
// at a time. The turn only reads posting pages with web fetch, so it does not wait for OpenClaw's
// browser; its session key is cron-prefixed so the deploy queue does not count it as a chat.
import { readShortTermCompass } from '@/lib/compass/read';
import { extractJsonObject } from '@/lib/done-at';
import {
  buildJudgeBatches, buildJudgePrompt, validateJudgeReply, JUDGE_TURN_TIMEOUT_MS,
  type JudgeItem, type JudgeVerdict,
} from '@/lib/job-wide-net-judge';
import { runOpenClawAgentTurn } from '@/lib/openclaw-agent';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';

export interface JudgeDeps {
  available: () => boolean;
  turn: (input: { message: string; sessionKey: string; timeoutMs: number }) => Promise<string>;
  forAgents: () => string;
}

export const cliJudgeDeps: JudgeDeps = {
  available: isOpenClawCliAvailable,
  turn: (input) => runOpenClawAgentTurn(input),
  forAgents: () => {
    try {
      return readShortTermCompass().forAgents;
    } catch {
      return '';
    }
  },
};

export interface JudgeOutcome {
  /** By link key. A posting with no entry was not judged and is sent again by the next check. */
  verdicts: Record<string, JudgeVerdict>;
  /** The last turn that failed, when one did. */
  error?: string;
}

/** Never throws: a turn that fails or answers badly leaves its postings unjudged. */
export async function judgeWideNetPostings(items: JudgeItem[], deps: JudgeDeps = cliJudgeDeps): Promise<JudgeOutcome> {
  const verdicts: Record<string, JudgeVerdict> = {};
  let error: string | undefined;
  const forAgents = deps.forAgents();
  for (const [index, batch] of buildJudgeBatches(items).entries()) {
    try {
      const answer = await deps.turn({
        message: buildJudgePrompt(batch, { forAgents }),
        sessionKey: `agent:main:cron:journal-wide-net-${Date.now()}-${index}`,
        timeoutMs: JUDGE_TURN_TIMEOUT_MS,
      });
      const check = validateJudgeReply(extractJsonObject(answer), batch.aliases);
      if (check.problems.length) console.warn('Wide net judge: reply problems:', check.problems.slice(0, 10).join('; '));
      Object.assign(verdicts, check.verdicts);
    } catch (turnError) {
      error = turnError instanceof Error ? turnError.message : String(turnError);
      console.error('Wide net judge: OpenClaw turn failed:', error);
    }
  }
  return { verdicts, ...(error ? { error } : {}) };
}
