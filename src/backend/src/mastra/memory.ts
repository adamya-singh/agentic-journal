import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

const storage = new LibSQLStore({
  id: 'journal-storage',
  url: 'file:./storage.db', // Local SQLite database file
});

export const memory = new Memory({
  options: {
    lastMessages: 5,
  },
  storage,
});

export { storage };
