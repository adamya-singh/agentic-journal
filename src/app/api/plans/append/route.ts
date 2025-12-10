import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { DayPlan, PlanEntry, isTextPlanEntry, isTaskPlanEntry } from '@/lib/types';

// Path to the daily-plans directory
const PLANS_DIR = path.join(process.cwd(), 'src/backend/data/daily-plans');

// Valid hours of the day (7am to 6am)
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

// Date format regex (ISO: YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Helper function to validate date format (ISO: YYYY-MM-DD)
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
 * Helper function to check if a plan file exists for a given date
 */
function planFileExists(date: string): boolean {
  const filePath = getPlanFilePath(date);
  return fs.existsSync(filePath);
}

/**
 * Helper function to read a plan file
 */
function readPlanFile(date: string): DayPlan {
  const filePath = getPlanFilePath(date);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Helper function to write a plan file
 */
function writePlanFile(date: string, plan: DayPlan): void {
  const filePath = getPlanFilePath(date);
  fs.writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf-8');
}

/**
 * Get text content from an entry (for appending purposes)
 */
function getEntryText(entry: PlanEntry): string {
  if (typeof entry === 'string') {
    return entry;
  }
  if (isTextPlanEntry(entry)) {
    return entry.text;
  }
  // Task entries can't be appended to - they're references
  return '';
}

/**
 * POST /api/plans/append
 * Appends text to a specific hour's plan entry
 * 
 * Note: This only works for text entries. If the current entry is a task reference,
 * the append will fail because task references are atomic.
 * 
 * Body: { date: string, hour: string, text: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, hour, text } = body;

    // Validate date
    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use ISO format (YYYY-MM-DD, e.g., 2025-11-25)' },
        { status: 400 }
      );
    }

    // Validate hour
    if (!hour || !VALID_HOURS.includes(hour)) {
      return NextResponse.json(
        { success: false, error: `Invalid hour. Must be one of: ${VALID_HOURS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate text
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Text parameter is required and cannot be empty' },
        { status: 400 }
      );
    }

    // Check if plan exists
    if (!planFileExists(date)) {
      return NextResponse.json(
        { success: false, error: `No plan exists for date ${date}. Create one first.` },
        { status: 404 }
      );
    }

    // Read current plan
    const plan = readPlanFile(date);
    const currentEntry = plan[hour];

    // Check if current entry is a task reference (can't append to those)
    if (currentEntry && isTaskPlanEntry(currentEntry)) {
      return NextResponse.json(
        { success: false, error: 'Cannot append text to a task reference. Use update to replace it.' },
        { status: 400 }
      );
    }

    // Get current text content
    const currentText = currentEntry ? getEntryText(currentEntry) : '';

    // Append with newline separation if there's existing content
    let newText: string;
    if (currentText && currentText.trim() !== '') {
      newText = currentText + '\n' + text.trim();
    } else {
      newText = text.trim();
    }

    // Store as TextPlanEntry format
    plan[hour] = { text: newText };

    // Write updated plan
    writePlanFile(date, plan);

    return NextResponse.json({
      success: true,
      date,
      hour,
      message: `Successfully appended to plan at ${hour} on ${date}`,
      updatedEntry: plan[hour],
    });
  } catch (error) {
    console.error('Error appending to plan:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
