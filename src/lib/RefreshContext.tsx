'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface RefreshContextValue {
  // Counters that components can subscribe to
  taskRefreshCounter: number;
  journalRefreshCounter: number;
  
  // Functions to trigger refreshes
  refreshTasks: () => void;
  refreshJournal: () => void;
  refreshAll: () => void;
}

const RefreshContext = createContext<RefreshContextValue | null>(null);

export function RefreshProvider({ children }: { children: React.ReactNode }) {
  const [taskRefreshCounter, setTaskRefreshCounter] = useState(0);
  const [journalRefreshCounter, setJournalRefreshCounter] = useState(0);

  const refreshTasks = useCallback(() => {
    setTaskRefreshCounter(c => c + 1);
  }, []);

  const refreshJournal = useCallback(() => {
    setJournalRefreshCounter(c => c + 1);
  }, []);

  const refreshAll = useCallback(() => {
    setTaskRefreshCounter(c => c + 1);
    setJournalRefreshCounter(c => c + 1);
  }, []);

  return (
    <RefreshContext.Provider value={{
      taskRefreshCounter,
      journalRefreshCounter,
      refreshTasks,
      refreshJournal,
      refreshAll,
    }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  const context = useContext(RefreshContext);
  if (!context) {
    throw new Error('useRefresh must be used within a RefreshProvider');
  }
  return context;
}
