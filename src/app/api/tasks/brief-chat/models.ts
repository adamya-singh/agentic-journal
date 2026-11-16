// The OpenClaw model and thinking effort he picked for a task's chats in its workspace, one of each per task, in
// tasks/chat-models.json. A task with no pick follows OpenClaw's own default. Only the Next server writes this
// file, synchronously.
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { isModelKey, isThinkingLevel } from '@/lib/openclaw-models';

const COMMENT = 'What was picked for each task’s chats in its workspace: models (task id → "provider/model") and thinking (task id → effort). No entry: OpenClaw’s default.';

/** What is picked for one task's chats; null where nothing is, which means OpenClaw's default. */
export interface TaskChatPicks { model: string | null; thinking: string | null }

export function chatModelsFilePath(): string {
  return path.join(tasksDataDir(), 'chat-models.json');
}

function read(): { models: Record<string, string>; thinking: Record<string, string> } {
  const kept = (raw: unknown, ok: (value: unknown) => value is string) => {
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object') for (const [taskId, value] of Object.entries(raw as Record<string, unknown>)) if (ok(value)) out[taskId] = value;
    return out;
  };
  try {
    const stored = JSON.parse(fs.readFileSync(chatModelsFilePath(), 'utf-8')) as { models?: unknown; thinking?: unknown };
    return { models: kept(stored.models, isModelKey), thinking: kept(stored.thinking, isThinkingLevel) };
  } catch {
    return { models: {}, thinking: {} };
  }
}

/** The model and thinking effort picked for this task's chats. */
export function readTaskPicks(taskId: string): TaskChatPicks {
  const all = read();
  return { model: all.models[taskId] ?? null, thinking: all.thinking[taskId] ?? null };
}

/** Changes what is picked for this task's chats: a value sets it, null takes it off, a pick left out stays. */
export function setTaskPicks(taskId: string, change: Partial<TaskChatPicks>): TaskChatPicks {
  const all = read();
  const put = (into: Record<string, string>, value: string | null | undefined) => {
    if (value === undefined) return;
    if (value === null) delete into[taskId];
    else into[taskId] = value;
  };
  put(all.models, change.model);
  put(all.thinking, change.thinking);
  writeJsonFileAtomic(chatModelsFilePath(), { _comment: COMMENT, schemaVersion: 2, models: all.models, thinking: all.thinking });
  return { model: all.models[taskId] ?? null, thinking: all.thinking[taskId] ?? null };
}
