import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to the daily-plans directory
const PLANS_DIR = path.join(process.cwd(), 'src/backend/data/daily-plans');

// Valid hours of the day (7am to 6am)
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

// Date format regex (MMDDYY)
const DATE_REGEX = /^\d{6}$/;

type DayPlan = Record<string, string>;

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
 * Helper function to check if a plan file exists for a given date
 */
function planFileExists(date: string): boolean {
  const filePath = getPlanFilePath(date);
  return fs.existsSync(filePath);
}

/**
 * Helper function to get the empty plan template
 */
function getEmptyPlanTemplate(): DayPlan {
  const template: DayPlan = {};
  for (const hour of VALID_HOURS) {
    template[hour] = '';
  }
  return template;
}

/**
 * POST /api/plans/create
 * Creates a new plan file for the specified date if it doesn't exist
 * 
 * Body: { date: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date } = body;

    // Validate date
    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)' },
        { status: 400 }
      );
    }

    // Check if plan already exists
    if (planFileExists(date)) {
      return NextResponse.json({
        success: true,
        alreadyExists: true,
        message: `Plan for ${date} already exists.`,
      });
    }

    // Ensure the plans directory exists
    if (!fs.existsSync(PLANS_DIR)) {
      fs.mkdirSync(PLANS_DIR, { recursive: true });
    }

    // Create empty plan from template
    const template = getEmptyPlanTemplate();
    const filePath = getPlanFilePath(date);

    // Write the new plan file
    fs.writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      alreadyExists: false,
      message: `Successfully created plan for ${date}`,
    });
  } catch (error) {
    console.error('Error creating plan:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

