// The models OpenClaw can run a chat on, as `openclaw models list --json` prints them, and the one he picks for
// a task's chats in its workspace. OpenClaw's own app has this selector per chat; the workspace has it per task.
// Pure: the routes, the page and the tests share it.

export interface OpenClawModel {
  key: string;                   // what OpenClaw is told: "provider/model"
  name: string;                  // what he reads: "Gemini 3.8 Flash"
  isDefault: boolean;            // the one OpenClaw uses when nothing is picked
}

export interface OpenClawModels {
  models: OpenClawModel[];
  defaultKey: string | null;
}

/** A model key as it may be stored and passed on: one word of the letters OpenClaw's keys are made of. */
export const isModelKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value);

/** What `openclaw models list --json` printed, as a list to pick from. Null when it printed no models. */
export function readModelList(raw: unknown): OpenClawModels | null {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { models?: unknown }).models) ? (raw as { models: unknown[] }).models : null;
  if (!list) return null;
  const models: OpenClawModel[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, name, available, tags } = entry as Record<string, unknown>;
    if (!isModelKey(key) || available === false || models.some((have) => have.key === key)) continue;
    models.push({
      key,
      name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : key.slice(key.lastIndexOf('/') + 1),
      isDefault: Array.isArray(tags) && tags.includes('default'),
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
