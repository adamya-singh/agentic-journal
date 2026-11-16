import { isOpenClawCliAvailable, parseJsonObjectOutput, runOpenClawCli } from './openclaw-cron';
import { readModelList, type OpenClawModels } from './openclaw-models';

/**
 * Runs one turn of OpenClaw's main agent through the gateway and returns its reply text.
 * Reusing a session key continues the same conversation. Nothing is delivered to a chat channel.
 * With no `model` or `thinking` the turn runs on what OpenClaw would use by itself: the session's own model and
 * thinking effort when they were picked for it (in OpenClaw's app, or by setOpenClawSessionPicks), else its
 * defaults (agents.defaults in openclaw.json), the same as a chat started in OpenClaw's app.
 * The `--json` envelope is { status: 'ok', result: { payloads: [{ text }] } }.
 */
export async function runOpenClawAgentTurn(input: {
  message: string;
  sessionKey: string;
  timeoutMs?: number;
  /** The model for this turn ("provider/model"), over the session's and OpenClaw's own. */
  model?: string;
  /** How hard it thinks on this turn ("off", "low", "high" and so on), over the session's and the model's own. */
  thinking?: string;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const stdout = await runOpenClawCli(
    [
      'agent', '--agent', 'main',
      '--session-key', input.sessionKey,
      '--message', input.message,
      ...(input.model ? ['--model', input.model] : []),
      ...(input.thinking ? ['--thinking', input.thinking] : []),
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

// ---- The models a chat can run on.

const MODELS_FRESH_MS = 10 * 60_000;
const MODELS_TIMEOUT_MS = 30_000;
interface ModelsState { at: number; list: OpenClawModels | null; reading: Promise<OpenClawModels | null> | null }
// One server process, but each route bundle may load this module separately.
const shared = globalThis as typeof globalThis & { __openClawModels?: ModelsState };
const models: ModelsState = (shared.__openClawModels ??= { at: 0, list: null, reading: null });

/**
 * The models OpenClaw is set up with, read at most every ten minutes: from its gateway (`models.list`, which also
 * says how hard each can think), else from `openclaw models list --json` (models only). Null when OpenClaw is not
 * here or could not say; a list read earlier is still given while a newer one cannot be had.
 */
export function listOpenClawModels(): Promise<OpenClawModels | null> {
  if (!isOpenClawCliAvailable()) return Promise.resolve(null);
  if (models.list && Date.now() - models.at < MODELS_FRESH_MS) return Promise.resolve(models.list);
  models.reading ??= (async () => {
    try {
      const read = await runOpenClawCli(['gateway', 'call', 'models.list', '--timeout', '20000', '--json'], MODELS_TIMEOUT_MS)
        .then((stdout) => readModelList(parseJsonObjectOutput(stdout)))
        .catch(() => null)
        ?? readModelList(parseJsonObjectOutput(await runOpenClawCli(['models', 'list', '--json'], MODELS_TIMEOUT_MS)));
      if (read) { models.list = read; models.at = Date.now(); }
    } catch (error) {
      console.error('OpenClaw models could not be listed:', error instanceof Error ? error.message : error);
    } finally {
      models.reading = null;
    }
    return models.list;
  })();
  return models.reading;
}

const SESSION_PATCH_TIMEOUT_MS = 25_000;

/**
 * Picks the model and the thinking effort of one OpenClaw session, as the selectors in OpenClaw's own app do
 * (`sessions.patch`): later turns in that session run on them, there and from here, and the app shows them picked.
 * Null takes a pick off, so the session follows OpenClaw's default again; a pick left out is not touched. A session
 * that does not exist yet is made, with the picks on it. Resolves to whether OpenClaw took them; never rejects.
 */
export async function setOpenClawSessionPicks(sessionKey: string, picks: { model?: string | null; thinkingLevel?: string | null }): Promise<boolean> {
  if (!isOpenClawCliAvailable()) return false;
  try {
    const stdout = await runOpenClawCli(
      ['gateway', 'call', 'sessions.patch', '--params', JSON.stringify({ key: sessionKey, ...picks }), '--timeout', String(SESSION_PATCH_TIMEOUT_MS), '--json'],
      SESSION_PATCH_TIMEOUT_MS + 5000,
    );
    return parseJsonObjectOutput(stdout)?.ok === true;
  } catch (error) {
    console.error(`OpenClaw session ${sessionKey}: its model and thinking could not be set:`, error instanceof Error ? error.message : error);
    return false;
  }
}
