import { createTool } from '@mastra/core';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get current file's directory for ES modules
const currentFileUrl = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFileUrl);

// Path to the journal directory
const JOURNAL_DIR = path.join(currentDir, '../../../data/journal');
const FORMAT_PATH = path.join(JOURNAL_DIR, 'format.json');

// Valid hours of the day (7am to 6am)
const HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'] as const;
type HourOfDay = typeof HOURS[number];

// Journal structure type for a single day
type DayJournal = Record<HourOfDay, string>;

// Date format regex (MMDDYY)
const DATE_REGEX = /^\d{6}$/;

/**
 * Helper function to validate date format (MMDDYY)
 */
function isValidDateFormat(date: string): boolean {
  return DATE_REGEX.test(date);
}

/**
 * Helper function to get the path to a specific day's journal file
 */
function getJournalFilePath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.json`);
}

/**
 * Helper function to read a specific day's journal file
 */
function readDayJournalFile(date: string): DayJournal {
  const filePath = getJournalFilePath(date);
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as DayJournal;
  } catch (error) {
    console.error(`Error reading journal file for ${date}:`, error);
    throw new Error(`Failed to read journal file for date ${date}. The file may not exist.`);
  }
}

/**
 * Helper function to write to a specific day's journal file
 */
function writeDayJournalFile(date: string, journal: DayJournal): void {
  const filePath = getJournalFilePath(date);
  try {
    fs.writeFileSync(filePath, JSON.stringify(journal, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing journal file for ${date}:`, error);
    throw new Error(`Failed to write journal file for date ${date}`);
  }
}

/**
 * Helper function to read the format template
 */
function readFormatTemplate(): DayJournal {
  try {
    const data = fs.readFileSync(FORMAT_PATH, 'utf-8');
    return JSON.parse(data) as DayJournal;
  } catch (error) {
    console.error('Error reading format template:', error);
    throw new Error('Failed to read format template');
  }
}

/**
 * Helper function to check if a journal file exists for a given date
 */
function journalFileExists(date: string): boolean {
  const filePath = getJournalFilePath(date);
  return fs.existsSync(filePath);
}

/**
 * Tool to read a day's journal by date (MMDDYY format)
 */
export const readJournalTool = createTool({
  id: 'readJournal',
  description: 'Read the journal for a specific date. Returns all hourly entries for that day.',
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

      if (!journalFileExists(context.date)) {
        return {
          success: false,
          error: `No journal exists for date ${context.date}. Use createDayJournal to create one first.`,
        };
      }

      const journal = readDayJournalFile(context.date);
      
      return {
        success: true,
        date: context.date,
        journal,
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
 * Tool to append text to a specific hour's journal entry
 */
export const appendToJournalTool = createTool({
  id: 'appendToJournal',
  description: 'Append text to a specific hour\'s journal entry for a given date. The text will be added to the existing content with proper separation.',
  inputSchema: z.object({
    date: z.string().regex(/^\d{6}$/).describe('The date in MMDDYY format (e.g., 112525 for November 25, 2025)'),
    hour: z.enum(HOURS).describe('The hour to append to (e.g., "8am", "12pm", "5pm")'),
    text: z.string().min(1).describe('The text to append to the journal entry'),
  }),
  execute: async ({ context }) => {
    try {
      if (!isValidDateFormat(context.date)) {
        return {
          success: false,
          error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)',
        };
      }

      if (!journalFileExists(context.date)) {
        return {
          success: false,
          error: `No journal exists for date ${context.date}. Use createDayJournal to create one first.`,
        };
      }

      const journal = readDayJournalFile(context.date);
      const currentEntry = journal[context.hour];
      
      // Append with newline separation if there's existing content
      if (currentEntry && currentEntry.trim() !== '') {
        journal[context.hour] = currentEntry + '\n' + context.text;
      } else {
        journal[context.hour] = context.text;
      }
      
      writeDayJournalFile(context.date, journal);
      
      return {
        success: true,
        date: context.date,
        hour: context.hour,
        message: `Successfully appended to ${context.hour} on ${context.date}`,
        updatedEntry: journal[context.hour],
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
 * Tool to create a new journal file for a specific date
 */
export const createDayJournalTool = createTool({
  id: 'createDayJournal',
  description: 'Create a new journal file for a specific date using the format template. If a journal already exists for this date, it will not be overwritten.',
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

      // Check if journal already exists
      if (journalFileExists(context.date)) {
        return {
          success: true,
          alreadyExists: true,
          message: `Journal for ${context.date} already exists.`,
        };
      }

      // Read the format template and create new journal file
      const template = readFormatTemplate();
      writeDayJournalFile(context.date, template);
      
      return {
        success: true,
        alreadyExists: false,
        message: `Successfully created journal for ${context.date}`,
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
 * Tool to update/replace a specific hour's journal entry
 */
export const updateJournalEntryTool = createTool({
  id: 'updateJournalEntry',
  description: 'Update/replace the content of a specific hour\'s journal entry. This will overwrite any existing content at that hour.',
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

      if (!journalFileExists(context.date)) {
        return {
          success: false,
          error: `No journal exists for date ${context.date}. Use createDayJournal to create one first.`,
        };
      }

      const journal = readDayJournalFile(context.date);
      const previousEntry = journal[context.hour];
      journal[context.hour] = context.text;
      writeDayJournalFile(context.date, journal);

      return {
        success: true,
        date: context.date,
        hour: context.hour,
        message: `Successfully updated ${context.hour} on ${context.date}`,
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
 * Tool to delete/clear a specific hour's journal entry
 */
export const deleteJournalEntryTool = createTool({
  id: 'deleteJournalEntry',
  description: 'Delete/clear the content of a specific hour\'s journal entry. This will set the entry to an empty string.',
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

      if (!journalFileExists(context.date)) {
        return {
          success: false,
          error: `No journal exists for date ${context.date}.`,
        };
      }

      const journal = readDayJournalFile(context.date);
      const deletedEntry = journal[context.hour];
      
      if (!deletedEntry || deletedEntry.trim() === '') {
        return {
          success: true,
          date: context.date,
          hour: context.hour,
          message: `Entry at ${context.hour} on ${context.date} was already empty.`,
          deletedEntry: '',
        };
      }

      journal[context.hour] = '';
      writeDayJournalFile(context.date, journal);

      return {
        success: true,
        date: context.date,
        hour: context.hour,
        message: `Successfully deleted entry at ${context.hour} on ${context.date}`,
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
