'use client';

import React, { useEffect, useState } from 'react';

// Journal entry type
type DayJournal = Record<string, string>;

// Week data type
type WeekData = Record<string, DayJournal | null>;

interface DayInfo {
  date: string; // MMDDYY format
  dayName: string; // e.g., "Mon"
  displayDate: string; // e.g., "11/25"
}

/**
 * Get the Monday-Sunday dates for the current week
 */
function getCurrentWeekDates(): DayInfo[] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Calculate Monday of the current week
  // If today is Sunday (0), go back 6 days to get Monday
  // Otherwise, go back (dayOfWeek - 1) days
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToMonday);
  
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekDates: DayInfo[] = [];
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    
    weekDates.push({
      date: `${month}${day}${year}`,
      dayName: dayNames[i],
      displayDate: `${month}/${day}`,
    });
  }
  
  return weekDates;
}

/**
 * Filter journal entries to only include non-empty ones
 */
function getNonEmptyEntries(journal: DayJournal | null): { hour: string; text: string }[] {
  if (!journal) return [];
  
  return Object.entries(journal)
    .filter(([, text]) => text && text.trim() !== '')
    .map(([hour, text]) => ({ hour, text }));
}

export function WeekView() {
  const [weekDates] = useState<DayInfo[]>(getCurrentWeekDates);
  const [weekData, setWeekData] = useState<WeekData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchWeekJournals() {
      try {
        setLoading(true);
        setError(null);
        
        const dates = weekDates.map(d => d.date);
        const response = await fetch('/api/journal/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dates }),
        });
        
        const data = await response.json();
        
        if (data.success) {
          setWeekData(data.journals);
        } else {
          setError(data.error || 'Failed to fetch journals');
        }
      } catch (err) {
        setError('Failed to connect to server');
      } finally {
        setLoading(false);
      }
    }
    
    fetchWeekJournals();
  }, [weekDates]);

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <h2 className="text-2xl font-semibold text-gray-700 mb-4 text-center">This Week</h2>
        <div className="grid grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-64 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <h2 className="text-2xl font-semibold text-gray-700 mb-4 text-center">This Week</h2>
        <div className="text-center text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <h2 className="text-2xl font-semibold text-gray-700 mb-4 text-center">This Week</h2>
      <div className="grid grid-cols-7 gap-3">
        {weekDates.map((dayInfo) => {
          const entries = getNonEmptyEntries(weekData[dayInfo.date]);
          const isToday = dayInfo.date === weekDates.find(d => {
            const today = new Date();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const year = String(today.getFullYear()).slice(-2);
            return d.date === `${month}${day}${year}`;
          })?.date;

          return (
            <div
              key={dayInfo.date}
              className={`flex flex-col rounded-lg border overflow-hidden ${
                isToday
                  ? 'border-indigo-400 bg-indigo-50 shadow-md'
                  : 'border-gray-200 bg-white'
              }`}
            >
              {/* Date header */}
              <div
                className={`px-3 py-2 text-center border-b ${
                  isToday
                    ? 'bg-indigo-500 text-white border-indigo-400'
                    : 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
              >
                <div className="font-semibold">{dayInfo.dayName}</div>
                <div className="text-sm opacity-80">{dayInfo.displayDate}</div>
              </div>

              {/* Journal entries */}
              <div className="flex-1 p-2 min-h-[200px] max-h-[300px] overflow-y-auto">
                {entries.length > 0 ? (
                  <div className="space-y-2">
                    {entries.map(({ hour, text }) => (
                      <div key={hour} className="text-sm">
                        <span className={`font-medium ${isToday ? 'text-indigo-600' : 'text-gray-500'}`}>
                          {hour}:
                        </span>{' '}
                        <span className="text-gray-700">{text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm italic">
                    No entries
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

