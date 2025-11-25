import { createTool } from '@mastra/core';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get current file's directory for ES modules
const currentFileUrl = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFileUrl);

// Path to the journal file
const JOURNAL_PATH = path.join(currentDir, '../../../data/journal.json');

// Valid days of the week
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type DayOfWeek = typeof DAYS[number];

// Journal structure type
type Journal = Record<DayOfWeek, string>;

/**
 * Helper function to read the journal file
 */
function readJournalFile(): Journal {
  try {
    const data = fs.readFileSync(JOURNAL_PATH, 'utf-8');
    return JSON.parse(data) as Journal;
  } catch (error) {
    console.error('Error reading journal file:', error);
    throw new Error('Failed to read journal file');
  }
}

/**
 * Helper function to write to the journal file
 */
function writeJournalFile(journal: Journal): void {
  try {
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing journal file:', error);
    throw new Error('Failed to write journal file');
  }
}

/**
 * Helper function to get current day of week
 */
function getCurrentDay(): DayOfWeek {
  const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = new Date().getDay();
  return days[dayIndex];
}

/**
 * Tool to read the journal - either entire journal or a specific day
 */
export const readJournalTool = createTool({
  id: 'readJournal',
  description: 'Read the weekly journal. Can read the entire journal or a specific day. If no day is specified, returns all days.',
  inputSchema: z.object({
    day: z.enum(DAYS).optional().describe('The day of the week to read (optional - if not provided, reads entire journal)'),
  }),
  execute: async ({ context }) => {
    try {
      const journal = readJournalFile();
      
      if (context.day) {
        return {
          success: true,
          day: context.day,
          entry: journal[context.day],
        };
      }
      
      return {
        success: true,
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
 * Tool to append text to a specific day's journal entry
 */
export const appendToJournalTool = createTool({
  id: 'appendToJournal',
  description: 'Append text to a specific day\'s journal entry. The text will be added to the existing content with proper separation.',
  inputSchema: z.object({
    day: z.enum(DAYS).describe('The day of the week to append to'),
    text: z.string().min(1).describe('The text to append to the journal entry'),
  }),
  execute: async ({ context }) => {
    try {
      const journal = readJournalFile();
      const currentEntry = journal[context.day];
      
      // Append with newline separation if there's existing content
      if (currentEntry && currentEntry.trim() !== '') {
        journal[context.day] = currentEntry + '\n' + context.text;
      } else {
        journal[context.day] = context.text;
      }
      
      writeJournalFile(journal);
      
      return {
        success: true,
        day: context.day,
        message: `Successfully appended to ${context.day}'s journal`,
        updatedEntry: journal[context.day],
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
 * Tool to get today's journal entry
 */
export const getCurrentDayJournalTool = createTool({
  id: 'getCurrentDayJournal',
  description: 'Get the journal entry for today (current day of the week). Automatically determines the current day and returns its journal entry.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const today = getCurrentDay();
      const journal = readJournalFile();
      
      return {
        success: true,
        day: today,
        entry: journal[today],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
});

