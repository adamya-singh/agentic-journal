'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { WeekRail } from '../features/WeekRail';
import { BacklogSidebar } from '../features/BacklogSidebar';
import { WeekViewData } from '@/components/WeekView'; // Reusing type
import { Task } from '@/components/TaskLists'; // Reusing type

interface ShellProps {
    children: React.ReactNode;
    currentDate: string;
    onDateSelect: (date: string) => void;
    weekData?: WeekViewData | null;
    tasks?: {
        haveToDo: Task[];
        wantToDo: Task[];
    } | null;
}

export function Shell({
    children,
    currentDate,
    onDateSelect,
    weekData,
    tasks
}: ShellProps) {
    const [isBacklogOpen, setIsBacklogOpen] = useState(false);

    // Handle drag start for tasks (will be used to drop into Today)
    const handleDragStart = (e: React.DragEvent, task: Task) => {
        e.dataTransfer.setData('application/json', JSON.stringify(task));
        e.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden font-sans">
            {/* Main Content Area */}
            <div className={cn(
                "flex-1 flex flex-col transition-all duration-300",
                isBacklogOpen ? "mr-80" : "mr-12"
            )}>
                {/* Top Rail */}
                <WeekRail
                    currentDate={currentDate}
                    onDateSelect={onDateSelect}
                    weekData={weekData}
                />

                {/* Focus Area (The Children) */}
                <main className="flex-1 overflow-y-auto relative scroll-smooth">
                    <div className="max-w-4xl mx-auto p-6 md:p-10 pb-32">
                        {children}
                    </div>
                </main>
            </div>

            {/* Right Sidebar (Backlog) */}
            <BacklogSidebar
                isOpen={isBacklogOpen}
                onToggle={() => setIsBacklogOpen(!isBacklogOpen)}
                haveToDoTasks={tasks?.haveToDo || []}
                wantToDoTasks={tasks?.wantToDo || []}
                onDragStart={handleDragStart}
            />
        </div>
    );
}
