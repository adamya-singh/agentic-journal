import { createTool } from '@mastra/core';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get current file's directory for ES modules
const currentFileUrl = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFileUrl);

// Path to the daily-plans directory
const PLANS_DIR = path.join(currentDir, '../../../data/daily-plans');

// Valid hours of the day (7am to 6am)
const HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'] as const;
type HourOfDay = typeof HOURS[number];

// Plan structure type for a single day
type DayPlan = Record<HourOfDay, string>;

// Date format regex (MMDDYY)
const DATE_REGEX = /^\d{6}$/;

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
 * Helper function to read a specific day's plan file
 */
function readDayPlanFile(date: string): DayPlan {
  const filePath = getPlanFilePath(date);
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as DayPlan;
  } catch (error) {
    console.error(`Error reading plan file for ${date}:`, error);
    throw new Error(`Failed to read plan file for date ${date}. The file may not exist.`);
  }
}

/**
 * Helper function to write to a specific day's plan file
 */
function writeDayPlanFile(date: string, plan: DayPlan): void {
  const filePath = getPlanFilePath(date);
  try {
    fs.writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing plan file for ${date}:`, error);
    throw new Error(`Failed to write plan file for date ${date}`);
  }
}

/**
 * Helper function to get the empty plan template
 */
function getEmptyPlanTemplate(): DayPlan {
  const template: Partial<DayPlan> = {};
  for (const hour of HOURS) {
    template[hour] = '';
  }
  return template as DayPlan;
}

/**
 * Helper function to check if a plan file exists for a given date
 */
function planFileExists(date: string): boolean {
  const filePath = getPlanFilePath(date);
  return fs.existsSync(filePath);
}

/**
 * Tool to read a day's plan by date (MMDDYY format)
 */
export const readPlanTool = createTool({
  id: 'readPlan',
  description: 'Read the daily plan for a specific date. Returns all hourly plan entries for that day.',
  inputSchema: z.object({
    date: z.string().regex(/^\d{6}$/).describe('The date to read in MMDDYY format (e.g., 112525 for November 25, 2025)'),
  }),
  execute: async ({ context }) => {
    try {
      if (!isValidDateFormat(context.date)) {
        return {
          success: false,
          error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)',
        };
      }

      if (!planFileExists(context.date)) {
        return {
          success: false,
          error: `No plan exists for date ${context.date}. Use createDayPlan to create one first.`,
        };
      }

      const plan = readDayPlanFile(context.date);
      
      return {
        success: true,
        date: context.date,
        plan,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
});

/**
 * Tool to append text to a specific hour's plan entry
 */
export const appendToPlanTool = createTool({
  id: 'appendToPlan',
  description: 'Append text to a specific hour\'s plan entry for a given date. The text will be added to the existing content with proper separation.',
  inputSchema: z.object({
    date: z.string().regex(/^\d{6}$/).describe('The date in MMDDYY format (e.g., 112525 for November 25, 2025)'),
    hour: z.enum(HOURS).describe('The hour to append to (e.g., "8am", "12pm", "5pm")'),
    text: z.string().min(1).describe('The text to append to the plan entry'),
  }),
  execute: async ({ context }) => {
    try {
      if (!isValidDateFormat(context.date)) {
        return {
          success: false,
          error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)',
        };
      }

      if (!planFileExists(context.date)) {
        return {
          success: false,
          error: `No plan exists for date ${context.date}. Use createDayPlan to create one first.`,
        };
      }

      const plan = readDayPlanFile(context.date);
      const currentEntry = plan[context.hour];
      
      // Append with newline separation if there's existing content
      if (currentEntry && currentEntry.trim() !== '') {
        plan[context.hour] = currentEntry + '\n' + context.text;
      } else {
        plan[context.hour] = context.text;
      }
      
      writeDayPlanFile(context.date, plan);
      
      return {
        success: true,
        date: context.date,
        hour: context.hour,
        message: `Successfully appended to plan at ${context.hour} on ${context.date}`,
        updatedEntry: plan[context.hour],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
});

/**
 * Tool to create a new plan file for a specific date
 */
export const createDayPlanTool = createTool({
  id: 'createDayPlan',
  description: 'Create a new daily plan file for a specific date. If a plan already exists for this date, it will not be overwritten.',
  inputSchema: z.object({
    date: z.string().regex(/^\d{6}$/).describe('The date in MMDDYY format (e.g., 112525 for November 25, 2025)'),
  }),
  execute: async ({ context }) => {
    try {
      if (!isValidDateFormat(context.date)) {
        return {
          success: false,
          error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)',
        };
      }

      // Check if plan already exists
      if (planFileExists(context.date)) {
        return {
          success: true,
          alreadyExists: true,
          message: `Plan for ${context.date} already exists.`,
        };
      }

      // Create new plan file with empty template
      const template = getEmptyPlanTemplate();
      writeDayPlanFile(context.date, template);
      
      return {
        success: true,
        alreadyExists: false,
        message: `Successfully created plan for ${context.date}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
});

/**
 * Tool to update/replace a specific hour's plan entry
 */
export const updatePlanEntryTool = createTool({
  id: 'updatePlanEntry',
  description: 'Update/replace the content of a specific hour\'s plan entry. This will overwrite any existing content at that hour.',
  inputSchema: z.object({
    date: z.string().regex(/^\d{6}$/).describe('The date in MMDDYY format (e.g., 112525 for November 25, 2025)'),
    hour: z.enum(HOURS).describe('The hour to update (e.g., "8am", "12pm", "5pm")'),
    text: z.string().describe('The new text to replace the existing entry'),
  }),
  execute: async ({ context }) => {
    try {
      if (!isValidDateFormat(context.date)) {
        return {
          success: false,
          error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)',
        };
      }

      if (!planFileExists(context.date)) {
        return {
          success: false,
          error: `No plan exists for date ${context.date}. Use createDayPlan to create one first.`,
        };
      }

      const plan = readDayPlanFile(context.date);
      const previousEntry = plan[context.hour];
      plan[context.hour] = context.text;
      writeDayPlanFile(context.date, plan);

      return {
        success: true,
        date: context.date,
        hour: context.hour,
        message: `Successfully updated plan at ${context.hour} on ${context.date}`,
        previousEntry,
        newEntry: context.text,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
});

/**
 * Tool to delete/clear a specific hour's plan entry
 */
export const deletePlanEntryTool = createTool({
  id: 'deletePlanEntry',
  description: 'Delete/clear the content of a specific hour\'s plan entry. This will set the entry to an empty string.',
  inputSchema: z.object({
    date: z.string().regex(/^\d{6}$/).describe('The date in MMDDYY format (e.g., 112525 for November 25, 2025)'),
    hour: z.enum(HOURS).describe('The hour to clear (e.g., "8am", "12pm", "5pm")'),
  }),
  execute: async ({ context }) => {
    try {
      if (!isValidDateFormat(context.date)) {
        return {
          success: false,
          error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)',
        };
      }

      if (!planFileExists(context.date)) {
        return {
          success: false,
          error: `No plan exists for date ${context.date}.`,
        };
      }

      const plan = readDayPlanFile(context.date);
      const deletedEntry = plan[context.hour];
      
      if (!deletedEntry || deletedEntry.trim() === '') {
        return {
          success: true,
          date: context.date,
          hour: context.hour,
          message: `Plan entry at ${context.hour} on ${context.date} was already empty.`,
          deletedEntry: '',
        };
      }

      plan[context.hour] = '';
      writeDayPlanFile(context.date, plan);

      return {
        success: true,
        date: context.date,
        hour: context.hour,
        message: `Successfully deleted plan entry at ${context.hour} on ${context.date}`,
        deletedEntry,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
});

