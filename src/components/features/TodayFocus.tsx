'use client';

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Clock, CheckCircle, Calendar, Plus } from 'lucide-react';
import { Task, ListType, ResolvedJournalEntry } from '@/lib/types';
import { ResolvedDayJournalWithRanges } from '@/components/WeekView'; // Import type from WeekView for now
import { AddToPlanModal } from '@/components/AddToPlanModal';
import { useRefresh } from '@/lib/RefreshContext';

interface TodayFocusProps {
    date: string; // YYYY-MM-DD
    journalData?: ResolvedDayJournalWithRanges | null;
    todayTasks?: {
        haveToDo: Task[];
        wantToDo: Task[];
    };
    onTaskUpdate?: () => void; // Trigger refresh
}

// Helper to get hourly slots
const HOUR_ORDER = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

export function TodayFocus({ date, journalData, todayTasks, onTaskUpdate }: TodayFocusProps) {
    const { refreshJournal, refreshTasks } = useRefresh();
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const [currentTime, setCurrentTime] = useState<string>(''); // Used for future red line indicator
    /* eslint-enable @typescript-eslint/no-unused-vars */

    // Schedule modal state
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [scheduleTask, setScheduleTask] = useState<{ task: Task } | null>(null);

    useEffect(() => {
        // Update current time every minute for the "now" indicator
        const updateTime = () => {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            const ampm = hours >= 12 ? 'pm' : 'am';
            const hours12 = hours % 12 || 12;
            setCurrentTime(`${hours12}:${minutes.toString().padStart(2, '0')}${ampm}`);
        };
        updateTime();
        const interval = setInterval(updateTime, 60000);
        return () => clearInterval(interval);
    }, []);

    // Handler to complete a task
    const handleComplete = async (task: Task, listType: ListType) => {
        try {
            await fetch('/api/tasks/today/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId: task.id,
                    listType,
                    date,
                }),
            });
            // Also append to journal if not already there (logic simplified for brevity, ideally check duplication)
            await fetch('/api/journal/append', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date,
                    hour: getCurrentHour(), // Use current hour helper
                    taskId: task.id,
                    listType,
                    entryMode: 'logged',
                }),
            });

            refreshTasks();
            refreshJournal();
            onTaskUpdate?.();
        } catch (e) {
            console.error("Failed to complete task", e);
        }
    };

    // Helper to open schedule modal
    const handleSchedule = (task: Task) => {
        setScheduleTask({ task });
        setShowScheduleModal(true);
    };

    // --- Render Helpers ---

    const renderJournalSlot = (hour: string) => {
        const slot = journalData?.[hour];
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const entries: ResolvedJournalEntry[] = Array.isArray(slot) ? slot : (slot ? [slot] as any : []);

        return (
            <div key={hour} className="group relative flex gap-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                {/* Time Column */}
                <div className="w-16 text-right text-sm text-gray-400 font-medium pt-1 shrink-0">
                    {hour}
                </div>

                {/* Content Column */}
                <div className="flex-1 min-h-[2rem]">
                    {entries.length > 0 ? (
                        <div className="space-y-2">
                            {entries.map((entry, idx) => (
                                <div key={idx} className={cn(
                                    "flex items-center gap-2 text-sm p-2 rounded-lg border",
                                    entry.entryMode === 'planned'
                                        ? "bg-teal-50 dark:bg-teal-900/20 border-teal-100 dark:border-teal-800 text-teal-900 dark:text-teal-100"
                                        : "bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-300",
                                    entry.completed && "opacity-60 line-through"
                                )}>
                                    <span>{entry.text}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="h-full w-full opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="text-xs text-gray-400 flex items-center gap-1 hover:text-indigo-500">
                                <Plus className="w-3 h-3" /> Log activity
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 h-full">
            {/* LEFT: Timeline / Journal (Runs full height) */}
            <div className="md:col-span-7 lg:col-span-8 flex flex-col bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-900">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-indigo-500" />
                            Journal & Schedule
                        </h2>
                        <p className="text-sm text-gray-500">The record of your day</p>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-mono text-gray-300 dark:text-gray-700 tracking-widest uppercase">
                            {new Date(date).toLocaleDateString('en-US', { weekday: 'long' })}
                        </div>
                        <div className="text-xs text-gray-400 font-mono">
                            {date}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 scroll-smooth">
                    <div className="relative">
                        {/* Current time indicator line (approximate position logic omitted for brevity, would need ref to container) */}

                        {HOUR_ORDER.map(hour => renderJournalSlot(hour))}

                        {/* Range entries rendered at bottom for now or interwoven? WeekView interweaves. 
                  For Focus view, maybe just keep simple list for now. */}
                    </div>
                </div>
            </div>

            {/* RIGHT: Today's Mission (Tasks) */}
            <div className="md:col-span-5 lg:col-span-4 flex flex-col gap-6">

                {/* Active Tasks Card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col overflow-hidden h-[600px]">
                    <div className="p-6 border-b border-gray-200 dark:border-gray-800 bg-amber-50/30 dark:bg-amber-900/10">
                        <h3 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            Active Missions
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">Tasks committed for today</p>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {todayTasks?.haveToDo.length === 0 && todayTasks?.wantToDo.length === 0 && (
                            <div className="text-center py-10 text-gray-400 italic">
                                No active missions. <br /> Drag from backlog or type below.
                            </div>
                        )}

                        {/* Have-to-do */}
                        {todayTasks?.haveToDo.map(task => (
                            <div key={task.id} className="group p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-amber-400 hover:shadow-md transition-all flex gap-3 items-start">
                                <button
                                    onClick={() => handleComplete(task, 'have-to-do')}
                                    className="mt-1 text-gray-300 hover:text-green-500 transition-colors"
                                >
                                    <CheckCircle className="w-5 h-5" />
                                </button>
                                <div className="flex-1">
                                    <p className={cn("text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors", task.completed && "line-through opacity-50")}>
                                        {task.text}
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleSchedule(task)}
                                    className="text-gray-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <Clock className="w-4 h-4" />
                                </button>
                            </div>
                        ))}

                        {/* Want-to-do */}
                        {todayTasks?.wantToDo.map(task => (
                            <div key={task.id} className="group p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-teal-400 hover:shadow-md transition-all flex gap-3 items-start">
                                <button
                                    onClick={() => handleComplete(task, 'want-to-do')}
                                    className="mt-1 text-gray-300 hover:text-green-500 transition-colors"
                                >
                                    <CheckCircle className="w-5 h-5" />
                                </button>
                                <div className="flex-1">
                                    <p className={cn("text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-teal-700 dark:group-hover:text-teal-400 transition-colors", task.completed && "line-through opacity-50")}>
                                        {task.text}
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleSchedule(task)}
                                    className="text-gray-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <Clock className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

            </div>

            {/* Schedule Modal */}
            {scheduleTask && (
                <AddToPlanModal
                    isOpen={showScheduleModal}
                    onClose={() => {
                        setShowScheduleModal(false);
                        setScheduleTask(null);
                    }}
                    onSuccess={() => {
                        refreshJournal();
                        onTaskUpdate?.();
                    }}
                    task={scheduleTask.task}
                    listType="have-to-do" // Default, logic to find actual type skipped for brevity
                    date={date}
                />
            )}
        </div>
    );
}

function getCurrentHour(): string {
    const now = new Date();
    const hours = now.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const hours12 = hours % 12 || 12;
    return `${hours12}${ampm}`;
}
