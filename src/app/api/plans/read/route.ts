import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to the daily-plans directory (relative to project root)
const PLANS_DIR = path.join(process.cwd(), 'src/backend/data/daily-plans');

// Date format regex (MMDDYY)
const DATE_REGEX = /^\d{6}$/;

// Valid hours of the day
const HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'] as const;
type HourOfDay = typeof HOURS[number];
type DayPlan = Record<HourOfDay, string>;

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
 * POST /api/plans/read
 * Reads daily plan entries for multiple dates
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dates } = body;

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

    // Read all plan entries
    const plans: Record<string, DayPlan | null> = {};
    for (const date of dates) {
      plans[date] = readPlanFile(date);
    }

    return NextResponse.json({
      success: true,
      plans,
    });
  } catch (error) {
    console.error('Error reading plans:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

