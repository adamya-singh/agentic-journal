// The models OpenClaw can run a chat on and how hard each can think, as OpenClaw's gateway lists them
// (`models.list`), and the ones he picks for a task's chats in its workspace. OpenClaw's own app has these
// selectors per chat; the workspace has them per task.
// Pure: the routes, the page and the tests share it.

/** One thinking effort a model can be run at: OpenClaw's id for it ("high") and the word shown for it. */
export interface ThinkingLevel { id: string; label: string }

export interface OpenClawModel {
  key: string;                   // what OpenClaw is told: "provider/model"
  name: string;                  // what he reads: "Gemini 3.8 Flash"
  isDefault: boolean;            // the one OpenClaw uses when nothing is picked
  thinking: ThinkingLevel[];     // the efforts it can think at, least first; empty when OpenClaw did not say
  thinkingDefault: string | null; // the effort it thinks at when none is picked
}

export interface OpenClawModels {
  models: OpenClawModel[];
  defaultKey: string | null;
}

/** A model key as it may be stored and passed on: one word of the letters OpenClaw's keys are made of. */
export const isModelKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value);

/** A thinking level's id as it may be stored and passed on: off, minimal, low, medium, high, xhigh, adaptive, max, ultra, or one a provider adds. */
export const isThinkingLevel = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{1,19}$/.test(value);

function readThinking(raw: unknown): ThinkingLevel[] {
  const levels: ThinkingLevel[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : entry;
    if (!isThinkingLevel(id) || levels.some((have) => have.id === id)) continue;
    const label = entry && typeof entry === 'object' ? (entry as { label?: unknown }).label : null;
    levels.push({ id, label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 30) : id });
  }
  return levels;
}

/**
 * What OpenClaw listed (`gateway call models.list`: rows of { provider, id, name, tags, thinkingLevels,
 * thinkingDefault }; or `openclaw models list --json`: rows of { key, name, tags }, which says nothing of thinking),
 * as a list to pick from. Null when it listed no models.
 */
export function readModelList(raw: unknown): OpenClawModels | null {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { models?: unknown }).models) ? (raw as { models: unknown[] }).models : null;
  if (!list) return null;
  const models: OpenClawModel[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const key = typeof row.key === 'string' ? row.key : typeof row.provider === 'string' && typeof row.id === 'string' ? `${row.provider}/${row.id}` : null;
    if (!isModelKey(key) || row.available === false || models.some((have) => have.key === key)) continue;
    const thinking = readThinking(row.thinkingLevels);
    models.push({
      key,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 80) : key.slice(key.lastIndexOf('/') + 1),
      isDefault: Array.isArray(row.tags) && row.tags.includes('default'),
      thinking,
      thinkingDefault: thinking.some((level) => level.id === row.thinkingDefault) ? row.thinkingDefault as string : null,
    });
  }
  if (models.length === 0) return null;
  return { models, defaultKey: models.find((model) => model.isDefault)?.key ?? null };
}

/** Whether a key is one of the models that can be picked now. */
export const hasModel = (list: OpenClawModels, key: string) => list.models.some((model) => model.key === key);

/** A model's name for him, or its key when the list does not have it (any more). */
export function modelName(list: OpenClawModels | null, key: string): string {
  return list?.models.find((model) => model.key === key)?.name ?? key.slice(key.lastIndexOf('/') + 1);
}

/** The model a task's chats run on: the one picked for it, else OpenClaw's default. Undefined when the list has neither. */
export function modelInUse(list: OpenClawModels | null, picked: string | null): OpenClawModel | undefined {
  const key = picked ?? list?.defaultKey;
  return key ? list?.models.find((model) => model.key === key) : undefined;
}

/** Whether a model can think at this effort. */
export const canThinkAt = (model: OpenClawModel | undefined, level: string) => !!model && model.thinking.some((have) => have.id === level);

/** A thinking level as he reads it: "High", "Off". */
export function thinkingName(model: OpenClawModel | undefined, level: string): string {
  const label = model?.thinking.find((have) => have.id === level)?.label ?? level;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
