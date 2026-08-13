import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { generateObject } from 'ai';
import { vertex } from '@ai-sdk/google-vertex';
import { z } from 'zod';
import { findOpenClawCronJob, isOpenClawCliAvailable, runOpenClawCli } from '@/lib/openclaw-cron';
import { recordCapturePriorityRequest } from './capture-priority-store-utils';
import { readGeneralTasks } from '../tasks/today/today-store-utils';
import { readProjectRoadmaps } from '../projects/roadmap-store-utils';
import { readProjectPreferences } from '../projects/preferences-store-utils';
import { addMiscTask } from '../tasks/misc/misc-store-utils';
import { normalizeProjectList } from '@/lib/projects';
import type { CaptureClassification, CaptureResponse } from '@/lib/capture/types';
import type { ListType } from '@/lib/types';

export const runtime = 'nodejs';

const LLM_TIMEOUT_MS = Number(process.env.CAPTURE_LLM_TIMEOUT_MS) || 6000;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIZE_CRON_JOB_NAME = 'Agentic Journal Capture Prioritization';

const ClassificationSchema = z.object({
  listType: z.enum(['have-to-do', 'want-to-do']),
  projects: z.array(z.string()),
  dueDate: z.string().nullable(),
  isDaily: z.boolean().nullable(),
  cleanedText: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ success: false, error: 'text is required' }, { status: 400 });
    }

    let classification: CaptureClassification | null = null;
    if (process.env.CAPTURE_LLM_DISABLED !== '1') {
      try {
        classification = await classifyCapture(text);
      } catch (error) {
        console.error('Capture classification failed, falling back to misc notes:', error);
      }
    }

    if (!classification) {
      const task = addMiscTask(text);
      const response: CaptureResponse = {
        success: true,
        taskId: task.id,
        task,
        listType: 'misc-notes',
        projects: [],
        classified: false,
      };
      return NextResponse.json(response);
    }

    const storedText = classification.cleanedText ?? text;
    const addResponse = await fetch('http://localhost:3000/api/tasks/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: storedText,
        listType: classification.listType,
        projects: classification.projects,
        dueDate: classification.dueDate,
        isDaily: classification.isDaily,
        notesMarkdown: `Captured: "${text}"`,
      }),
    });
    const addData = await addResponse.json();
    if (!addResponse.ok || !addData.success) {
      return NextResponse.json(
        { success: false, error: addData.error || 'Failed to save capture' },
        { status: 502 },
      );
    }

    // Record the prioritization request now (durable even if the trigger
    // fails — the hourly backstop drains the ledger), but defer the cron
    // trigger past the response so capture latency stays LLM-only.
    let prioritizationRequested = false;
    try {
      recordCapturePriorityRequest({
        taskId: addData.taskId,
        listType: classification.listType,
        text: storedText,
      });
      prioritizationRequested = true;
      after(() => queuePrioritizationCron());
    } catch (error) {
      console.error('Failed to record capture prioritization request:', error);
    }

    const response: CaptureResponse = {
      success: true,
      taskId: addData.taskId,
      task: addData.task,
      listType: classification.listType,
      projects: classification.projects,
      dueDate: classification.dueDate,
      isDaily: classification.isDaily,
      classified: true,
      cleanedText: classification.cleanedText,
      prioritizationRequested,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error handling capture:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

async function queuePrioritizationCron(): Promise<void> {
  try {
    if (!isOpenClawCliAvailable()) {
      return;
    }
    const job = await findOpenClawCronJob({
      jobId: process.env.OPENCLAW_CAPTURE_PRIORITIZE_CRON_ID,
      jobName: PRIORITIZE_CRON_JOB_NAME,
      timeoutMs: 30_000,
    });
    if (!job || !job.enabled) {
      return;
    }
    // Note: `cron run` takes no --json flag in current OpenClaw.
    await runOpenClawCli(['cron', 'run', job.id], 30_000);
  } catch (error) {
    // Non-fatal: the ledger entry stands and the hourly backstop drains it.
    console.error('Failed to trigger capture prioritization cron:', error);
  }
}

async function classifyCapture(text: string): Promise<CaptureClassification> {
  const knownSlugs = collectKnownProjectSlugs();
  const { object } = await generateObject({
    model: vertex('gemini-2.5-flash'),
    schema: ClassificationSchema,
    prompt: buildPrompt(text, knownSlugs),
    maxOutputTokens: 500,
    abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });

  const slugSet = new Set(knownSlugs);
  const projects = normalizeProjectList(object.projects).filter((slug) => slugSet.has(slug));
  const dueDate =
    object.dueDate && DATE_REGEX.test(object.dueDate) ? object.dueDate : undefined;
  const cleanedText =
    object.cleanedText && object.cleanedText.trim().length >= 3
      ? object.cleanedText.trim()
      : undefined;

  return {
    listType: object.listType as ListType,
    projects,
    dueDate,
    isDaily: object.isDaily === true ? true : undefined,
    cleanedText,
  };
}

function collectKnownProjectSlugs(): string[] {
  const slugs = new Set<string>();
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    for (const task of readGeneralTasks(listType).tasks) {
      for (const slug of normalizeProjectList(task.projects)) {
        slugs.add(slug);
      }
    }
  }
  for (const slug of Object.keys(readProjectRoadmaps().roadmaps)) {
    slugs.add(slug);
  }
  for (const slug of normalizeProjectList(readProjectPreferences().pinnedProjects)) {
    slugs.add(slug);
  }
  return [...slugs].sort();
}

function buildPrompt(text: string, knownSlugs: string[]): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const today = `${get('year')}-${get('month')}-${get('day')}`;
  const weekday = get('weekday');

  return `Classify a captured task fragment for a personal task system.

Today is ${weekday}, ${today} (America/New_York).

Rules:
- listType: use "have-to-do" for obligations and responsibilities, "want-to-do" for desires and optional activities.
- projects: only use slugs from this list; return [] if none clearly apply: ${knownSlugs.join(', ')}
- dueDate: resolve relative dates ("by friday", "tomorrow") to a concrete YYYY-MM-DD using today's date; null if no date is mentioned.
- isDaily: true only for explicit recurrence phrasing ("every day", "daily"); otherwise null.
- cleanedText: rewrite the fragment as a concise task title in standard technical English — correct spelling and grammar, sentence case, proper technical terminology — with metadata phrases (project mentions, date phrases, recurrence phrasing) removed. Always provide it. Never drop meaning or invent details.

Examples:
- "do laundry" -> listType "have-to-do", projects [], dueDate null, isDaily null, cleanedText "Do laundry"
- "try polymarket" -> listType "want-to-do", projects [], dueDate null, isDaily null, cleanedText "Try Polymarket"
- "buy drone parts for aviro by friday" -> listType "have-to-do", projects ["aviro"], dueDate <the upcoming Friday>, isDaily null, cleanedText "Buy drone parts"
- "meditate every day" -> listType "want-to-do", projects [], dueDate null, isDaily true, cleanedText "Meditate"
- "fix the thing where the page jumps around when u scroll" -> listType "have-to-do", projects [], dueDate null, isDaily null, cleanedText "Fix page jump on scroll"

Fragment: "${text}"`;
}
