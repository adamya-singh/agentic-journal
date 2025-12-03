import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  DayPlan,
  PlanEntry,
  ResolvedPlanEntry,
  ListType,
  Task,
  TasksData,
  isTaskPlanEntry,
  isTextPlanEntry,
} from '@/lib/types';

// Path to the daily-plans directory (relative to project root)
const PLANS_DIR = path.join(process.cwd(), 'src/backend/data/daily-plans');
const TASKS_DIR = path.join(process.cwd(), 'src/backend/data/tasks');

// Date format regex (MMDDYY)
const DATE_REGEX = /^\d{6}$/;

// Valid hours of the day
const HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'] as const;
type HourOfDay = typeof HOURS[number];

/**
 * Helper function to validate date format (MMDDYY)
 */
function isValidDateFormat(date: string): boolean {
  return DATE_REGEX.test(date);
}

/**
 * Helper function to get the path to a specific day's plan file
 */
function getPlanFilePath(date: string): string {
  return path.join(PLANS_DIR, `${date}.json`);
}

/**
 * Helper function to read a plan file if it exists
 */
function readPlanFile(date: string): DayPlan | null {
  const filePath = getPlanFilePath(date);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as DayPlan;
  } catch {
    return null;
  }
}

/**
 * Get the path for a date-specific task list
 */
function getDailyTasksFilePath(date: string, listType: ListType): string {
  return path.join(TASKS_DIR, `daily-lists/${date}-${listType}.json`);
}

/**
 * Get the path for the general task list
 */
function getGeneralTasksFilePath(listType: ListType): string {
  return path.join(TASKS_DIR, `${listType}.json`);
}

/**
 * Read tasks from a file
 */
function readTasksFile(filePath: string): Task[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as TasksData;
    return data.tasks || [];
  } catch {
    return [];
  }
}

/**
 * Find a task by ID across daily and general lists
 */
function findTaskById(taskId: string, listType: ListType, date: string): Task | null {
  // First check the daily list for this date
  const dailyTasks = readTasksFile(getDailyTasksFilePath(date, listType));
  const dailyTask = dailyTasks.find(t => t.id === taskId);
  if (dailyTask) {
    return dailyTask;
  }

  // Fall back to general list
  const generalTasks = readTasksFile(getGeneralTasksFilePath(listType));
  const generalTask = generalTasks.find(t => t.id === taskId);
  if (generalTask) {
    return generalTask;
  }

  return null;
}

/**
 * Resolve a plan entry to displayable format
 */
function resolveEntry(hour: string, entry: PlanEntry, date: string): ResolvedPlanEntry | null {
  // Handle task reference entries
  if (isTaskPlanEntry(entry)) {
    const task = findTaskById(entry.taskId, entry.listType, date);
    if (task) {
      return {
        hour,
        text: task.text,
        type: 'task',
        taskId: entry.taskId,
        listType: entry.listType,
        completed: task.completed,
      };
    }
    // Task not found - return placeholder
    return {
      hour,
      text: '[Task not found]',
      type: 'task',
      taskId: entry.taskId,
      listType: entry.listType,
      completed: false,
    };
  }

  // Handle text entries
  if (isTextPlanEntry(entry)) {
    if (!entry.text || entry.text.trim() === '') {
      return null;
    }
    return {
      hour,
      text: entry.text,
      type: 'text',
    };
  }

  // Handle legacy string entries
  if (typeof entry === 'string') {
    if (!entry || entry.trim() === '') {
      return null;
    }
    return {
      hour,
      text: entry,
      type: 'text',
    };
  }

  return null;
}

/**
 * Resolve all entries in a plan
 */
function resolvePlan(plan: DayPlan, date: string): Record<HourOfDay, ResolvedPlanEntry | null> {
  const resolved: Record<string, ResolvedPlanEntry | null> = {};
  
  for (const hour of HOURS) {
    const entry = plan[hour];
    if (entry) {
      resolved[hour] = resolveEntry(hour, entry, date);
    } else {
      resolved[hour] = null;
    }
  }
  
  return resolved as Record<HourOfDay, ResolvedPlanEntry | null>;
}

/**
 * POST /api/plans/read
 * Reads daily plan entries for multiple dates
 * 
 * Body: { dates: string[], resolve?: boolean }
 * - dates: Array of dates in MMDDYY format
 * - resolve: If true, resolves task IDs to full task objects (default: false)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dates, resolve = false } = body;

    if (!dates || !Array.isArray(dates)) {
      return NextResponse.json(
        { success: false, error: 'dates array parameter is required' },
        { status: 400 }
      );
    }

    // Validate all dates
    for (const date of dates) {
      if (!isValidDateFormat(date)) {
        return NextResponse.json(
          { success: false, error: `Invalid date format: ${date}. Please use MMDDYY format` },
          { status: 400 }
        );
      }
    }

    if (resolve) {
      // Return resolved plans with task details
      const resolvedPlans: Record<string, Record<HourOfDay, ResolvedPlanEntry | null> | null> = {};
      for (const date of dates) {
        const plan = readPlanFile(date);
        if (plan) {
          resolvedPlans[date] = resolvePlan(plan, date);
        } else {
          resolvedPlans[date] = null;
        }
      }

      return NextResponse.json({
        success: true,
        plans: resolvedPlans,
        resolved: true,
      });
    } else {
      // Return raw plans
      const plans: Record<string, DayPlan | null> = {};
      for (const date of dates) {
        plans[date] = readPlanFile(date);
      }

      return NextResponse.json({
        success: true,
        plans,
        resolved: false,
      });
    }
  } catch (error) {
    console.error('Error reading plans:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
