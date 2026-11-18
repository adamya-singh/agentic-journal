// One plain-text Telegram message to Adamya, for the Journal's once-a-day notices (what the task worker needs from
// him, which job applications are drafted and about to send). The chat is TASK_WORKER_TELEGRAM_TARGET or else the one
// OpenClaw's own announce crons deliver to; the bot is TASK_WORKER_TELEGRAM_BOT_TOKEN or else OpenClaw's Telegram bot.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseJsonObjectOutput, runOpenClawCli } from '@/lib/openclaw-cron';

const TARGET_RETRY_MS = 60 * 60_000;
const cache: { target: string | null; targetCheckedAt: number } = { target: null, targetCheckedAt: 0 };

export const telegramSendArgs = (target: string, text: string): string[] =>
  ['message', 'send', '--channel', 'telegram', '--target', target, '--message', text, '--json'];

/** The Telegram chat OpenClaw's announce crons deliver to (the most common one), from `cron list --all --json`. */
export function announceTargetFromCronList(output: string): string | null {
  const parsed = parseJsonObjectOutput(output);
  const jobs = Array.isArray(parsed?.jobs) ? (parsed.jobs as { delivery?: { mode?: unknown; channel?: unknown; to?: unknown } | null }[]) : [];
  const seen = new Map<string, number>();
  for (const job of jobs) {
    const d = job?.delivery;
    if (d?.mode === 'announce' && d.channel === 'telegram' && typeof d.to === 'string' && d.to.trim()) {
      seen.set(d.to.trim(), (seen.get(d.to.trim()) ?? 0) + 1);
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** TASK_WORKER_TELEGRAM_TARGET, or the announce crons' chat (read once, and again an hour after a miss). */
export async function telegramTarget(): Promise<string | null> {
  const fromEnv = process.env.TASK_WORKER_TELEGRAM_TARGET?.trim().replace(/^telegram:/i, '');
  if (fromEnv) return fromEnv;
  const s = cache;
  if (s.target) return s.target;
  if (Date.now() - s.targetCheckedAt < TARGET_RETRY_MS) return null;
  s.targetCheckedAt = Date.now();
  try {
    s.target = announceTargetFromCronList(await runOpenClawCli(['cron', 'list', '--all', '--json']));
  } catch (error) {
    console.error('Telegram: could not read the cron list:', error instanceof Error ? error.message : error);
  }
  return s.target;
}

/** The bot's token: TASK_WORKER_TELEGRAM_BOT_TOKEN, or the one OpenClaw's own Telegram channel uses. Never logged. */
function botToken(): string | null {
  const fromEnv = process.env.TASK_WORKER_TELEGRAM_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const config = JSON.parse(readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8')) as { channels?: { telegram?: { botToken?: unknown } } };
    const token = config.channels?.telegram?.botToken;
    return typeof token === 'string' && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

const argAfter = (args: string[], flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

/**
 * Straight to Telegram's bot API. `openclaw message send` delivers the message and then never exits
 * (2026-11-14: three tries, each killed at its timeout, each one delivered), so every retry sent it again.
 * Here the answer comes back in a second or two and says whether it went.
 */
export async function telegramSend(args: string[]): Promise<string> {
  const token = botToken();
  const chat = argAfter(args, '--target');
  const text = argAfter(args, '--message');
  if (!token || !chat || !text) throw new Error('no Telegram bot token, chat or text');
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    // The error of a failed fetch can carry the address, and the address carries the token.
    throw new Error(`Telegram could not be reached (${error instanceof Error ? error.name : 'error'})`);
  }
  const body = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || !body?.ok) throw new Error(`Telegram refused the message: ${body?.description ?? response.status}`);
  return 'sent';
}

export const telegramAvailable = () => botToken() !== null;
