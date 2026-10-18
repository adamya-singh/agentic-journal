'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { WeekViewData } from '@/components/WeekView';

interface WeekRailProps {
  currentDate: string;
  onDateSelect: (date: string) => void;
  weekData?: WeekViewData | null;
}

export function WeekRail({ currentDate, onDateSelect }: WeekRailProps) {
  // Mock days for now, ideally this comes from a hook or weekData
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Helper to generate dates for the current week (simplified for now)
  // In a real impl, we'd calculate based on current date
  const generateWeekDates = () => {
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sun, 1 = Mon...
    const diff = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1); // Adjust when day is Sunday

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(diff + i);
      return {
        name: days[i],
        date: d.toISOString().split('T')[0],
        dayNum: d.getDate(),
      };
    });
  };

  const weekDates = generateWeekDates();

  return (
    <div className="w-full flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm">
      <div className="flex items-center gap-1">
        {weekDates.map((day) => {
          const isSelected = day.date === currentDate;
          const isToday = day.date === new Date().toISOString().split('T')[0];

          return (
            <button
              key={day.date}
              onClick={() => onDateSelect(day.date)}
              className={cn(
                "flex flex-col items-center justify-center w-12 h-14 rounded-lg transition-all duration-200",
                isSelected
                  ? "bg-indigo-600 text-white shadow-md scale-105"
                  : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400",
                isToday && !isSelected && "text-indigo-600 dark:text-indigo-400 font-medium"
              )}
            >
              <span className="text-xs">{day.name}</span>
              <span className={cn("text-sm font-bold", isSelected ? "text-white" : "")}>
                {day.dayNum}
              </span>
              {/* Optional dot for indicators */}
              <div className={cn("w-1 h-1 rounded-full mt-1", isSelected ? "bg-white/50" : "bg-transparent")} />
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white hidden md:block">
          Agentic Journal
        </h1>
      </div>
    </div>
  );
}
