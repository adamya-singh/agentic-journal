// The OpenClaw model he picked for a task's chats in its workspace, one per task, in tasks/chat-models.json.
// A task with no pick follows OpenClaw's own default. Only the Next server writes this file, synchronously.
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { isModelKey } from '@/lib/openclaw-models';

const COMMENT = 'The OpenClaw model picked for each task’s chats in its workspace (task id → "provider/model"). No entry: OpenClaw’s default.';

export function chatModelsFilePath(): string {
  return path.join(tasksDataDir(), 'chat-models.json');
}

function read(): Record<string, string> {
  try {
    const stored = JSON.parse(fs.readFileSync(chatModelsFilePath(), 'utf-8')) as { models?: unknown };
    const out: Record<string, string> = {};
    if (stored.models && typeof stored.models === 'object') {
      for (const [taskId, key] of Object.entries(stored.models as Record<string, unknown>)) if (isModelKey(key)) out[taskId] = key;
    }
    return out;
  } catch {
    return {};
  }
}

/** The model picked for this task's chats, or null when none is: OpenClaw's default. */
export function readTaskModel(taskId: string): string | null {
  return read()[taskId] ?? null;
}

/** Picks a model for this task's chats; null takes the pick off. */
export function setTaskModel(taskId: string, model: string | null): void {
  const models = read();
  if (model === null) delete models[taskId];
  else models[taskId] = model;
  writeJsonFileAtomic(chatModelsFilePath(), { _comment: COMMENT, schemaVersion: 1, models });
}
