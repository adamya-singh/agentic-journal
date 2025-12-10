import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { DayPlan, PlanEntry, PlanRangeEntry } from '@/lib/types';

// Path to the daily-plans directory
const PLANS_DIR = path.join(process.cwd(), 'src/backend/data/daily-plans');

// Valid hours of the day (7am to 6am)
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

// Date format regex (ISO: YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Plan with ranges support
type DayPlanWithRanges = DayPlan & {
  ranges?: PlanRangeEntry[];
};

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
function readPlanFile(date: string): DayPlanWithRanges {
  const filePath = getPlanFilePath(date);
  const content = fs.readFileSync(filePath, 'utf-8');
  const plan = JSON.parse(content) as DayPlanWithRanges;
  // Ensure ranges array exists for backward compatibility
  if (!plan.ranges) {
    plan.ranges = [];
  }
  return plan;
}

/**
 * Helper function to write a plan file
 */
function writePlanFile(date: string, plan: DayPlanWithRanges): void {
  const filePath = getPlanFilePath(date);
  fs.writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf-8');
}

/**
 * POST /api/plans/update
 * Updates/replaces a specific hour's plan entry OR adds/updates a range entry
 * 
 * For hourly update:
 * Body: { date: string, hour: string, entry: PlanEntry }
 * 
 * entry can be:
 * - { taskId: string, listType: 'have-to-do' | 'want-to-do' } - task reference
 * - { text: string } - free-form text
 * - string - legacy plain text (for backward compatibility)
 * - '' or null - clears the entry
 * 
 * For range update:
 * Body: { date: string, range: { start: string, end: string, text?: string, taskId?: string, listType?: string } }
 * 
 * For range removal:
 * Body: { date: string, removeRange: { start: string, end: string } }
 * 
 * Legacy format also supported:
 * Body: { date: string, hour: string, text: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, hour, entry, text, taskId, listType, range, removeRange } = body;

    // Validate date
    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use ISO format (YYYY-MM-DD, e.g., 2025-11-25)' },
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

    // Handle range removal
    if (removeRange) {
      const { start, end } = removeRange;
      if (!start || !end || !VALID_HOURS.includes(start) || !VALID_HOURS.includes(end)) {
        return NextResponse.json(
          { success: false, error: 'Invalid range. start and end must be valid hours.' },
          { status: 400 }
        );
      }

      const initialLength = plan.ranges?.length || 0;
      plan.ranges = (plan.ranges || []).filter(
        r => !(r.start === start && r.end === end)
      );

      writePlanFile(date, plan);

      return NextResponse.json({
        success: true,
        date,
        message: `Removed range ${start}-${end} from ${date}`,
        removed: initialLength !== plan.ranges.length,
      });
    }

    // Handle range update/add
    if (range) {
      const { start, end, text: rangeText, taskId: rangeTaskId, listType: rangeListType } = range;
      
      if (!start || !end || !VALID_HOURS.includes(start) || !VALID_HOURS.includes(end)) {
        return NextResponse.json(
          { success: false, error: 'Invalid range. start and end must be valid hours.' },
          { status: 400 }
        );
      }

      // Validate start comes before end
      const startIdx = VALID_HOURS.indexOf(start);
      const endIdx = VALID_HOURS.indexOf(end);
      if (startIdx >= endIdx) {
        return NextResponse.json(
          { success: false, error: 'Range start must be before end' },
          { status: 400 }
        );
      }

      // Determine the range entry to save
      let newRange: PlanRangeEntry;
      if (rangeTaskId && rangeListType) {
        newRange = { start, end, taskId: rangeTaskId, listType: rangeListType };
      } else if (rangeText !== undefined) {
        newRange = { start, end, text: rangeText };
      } else {
        return NextResponse.json(
          { success: false, error: 'Range must have either text or taskId+listType' },
          { status: 400 }
        );
      }

      // Check if range already exists and update it, or add new
      const existingIdx = (plan.ranges || []).findIndex(
        r => r.start === start && r.end === end
      );

      if (existingIdx >= 0) {
        const previousRange = plan.ranges![existingIdx];
        plan.ranges![existingIdx] = newRange;
        writePlanFile(date, plan);

        return NextResponse.json({
          success: true,
          date,
          message: `Updated range ${start}-${end} on ${date}`,
          previousRange,
          newRange,
        });
      } else {
        plan.ranges = plan.ranges || [];
        plan.ranges.push(newRange);
        writePlanFile(date, plan);

        return NextResponse.json({
          success: true,
          date,
          message: `Added range ${start}-${end} on ${date}`,
          newRange,
        });
      }
    }

    // Handle hourly update (original behavior)
    if (!hour || !VALID_HOURS.includes(hour)) {
      return NextResponse.json(
        { success: false, error: `Invalid hour. Must be one of: ${VALID_HOURS.join(', ')}` },
        { status: 400 }
      );
    }

    // Determine the entry to save
    let entryToSave: PlanEntry;

    if (entry !== undefined) {
      // New format: entry is provided directly
      entryToSave = entry;
    } else if (taskId !== undefined && listType !== undefined) {
      // Task reference format
      entryToSave = { taskId, listType };
    } else if (text !== undefined) {
      // Legacy format: plain text
      if (text === '' || text === null) {
        entryToSave = '';
      } else if (typeof text === 'string') {
        // Wrap in TextPlanEntry for new format
        entryToSave = { text };
      } else {
        return NextResponse.json(
          { success: false, error: 'Invalid text parameter' },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'Entry, text, or taskId+listType parameter is required' },
        { status: 400 }
      );
    }

    const previousEntry = plan[hour] || '';

    // Update the entry
    plan[hour] = entryToSave;

    // Write updated plan
    writePlanFile(date, plan);

    return NextResponse.json({
      success: true,
      date,
      hour,
      message: `Successfully updated plan at ${hour} on ${date}`,
      previousEntry,
      newEntry: plan[hour],
    });
  } catch (error) {
    console.error('Error updating plan:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
