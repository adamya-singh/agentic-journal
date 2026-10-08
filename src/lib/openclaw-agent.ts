import { parseJsonObjectOutput, runOpenClawCli } from './openclaw-cron';

/**
 * Runs one turn of OpenClaw's main agent through the gateway and returns its reply text.
 * Reusing a session key continues the same conversation. Nothing is delivered to a chat channel.
 * The `--json` envelope is { status: 'ok', result: { payloads: [{ text }] } }.
 */
export async function runOpenClawAgentTurn(input: {
  message: string;
  sessionKey: string;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const stdout = await runOpenClawCli(
    [
      'agent', '--agent', 'main',
      '--session-key', input.sessionKey,
      '--message', input.message,
      '--thinking', 'low',
      '--timeout', String(Math.floor(timeoutMs / 1000) - 10),
      '--json',
    ],
    timeoutMs
  );
  const envelope = parseJsonObjectOutput(stdout);
  if (!envelope || envelope.status !== 'ok') {
    throw new Error(`OpenClaw agent turn failed: ${String(envelope?.summary ?? envelope?.status ?? 'no JSON output')}`);
  }
  const payloads = (envelope.result as { payloads?: Array<{ text?: unknown }> } | undefined)?.payloads ?? [];
  const text = payloads.map((p) => (typeof p.text === 'string' ? p.text : '')).join('\n').trim();
  if (!text) throw new Error('OpenClaw agent turn returned no text');
  return text;
}
