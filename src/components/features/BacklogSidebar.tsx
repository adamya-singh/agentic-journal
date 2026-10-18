'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, ClipboardList, Star } from 'lucide-react';
import { Task } from '@/components/TaskLists'; // Reusing existing type

interface BacklogSidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    haveToDoTasks: Task[];
    wantToDoTasks: Task[];
    onDragStart: (e: React.DragEvent, task: Task) => void;
}

export function BacklogSidebar({
    isOpen,
    onToggle,
    haveToDoTasks,
    wantToDoTasks,
    onDragStart
}: BacklogSidebarProps) {
    return (
        <div
            className={cn(
                "fixed right-0 top-0 h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 transition-all duration-300 ease-in-out z-20 flex flex-col shadow-xl",
                isOpen ? "w-80 translate-x-0" : "w-12 translate-x-full md:translate-x-0 md:w-12"
            )}
        >
            {/* Toggle Handle */}
            <button
                onClick={onToggle}
                className="absolute -left-3 top-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full p-1 shadow-md hover:scale-110 transition-transform z-30"
            >
                <ChevronRight className={cn("w-4 h-4 text-gray-500", isOpen ? "" : "rotate-180")} />
            </button>

            {/* Collapsed State Icons */}
            {!isOpen && (
                <div className="flex flex-col items-center pt-24 gap-6">
                    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 group relative">
                        <ClipboardList className="w-5 h-5" />
                        <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                            Have to do ({haveToDoTasks.length})
                        </span>
                    </div>
                    <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 group relative">
                        <Star className="w-5 h-5" />
                        <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                            Want to do ({wantToDoTasks.length})
                        </span>
                    </div>
                </div>
            )}

            {/* Expanded Content */}
            <div className={cn("flex-1 overflow-hidden flex flex-col", !isOpen && "hidden")}>
                <div className="p-5 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="font-semibold text-lg text-gray-900 dark:text-white">Backlog</h2>
                    <p className="text-xs text-gray-500">Drag tasks to Today to schedule them.</p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {/* Have To Do Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-3 text-amber-600 dark:text-amber-500 font-medium text-sm uppercase tracking-wider">
                            <ClipboardList className="w-4 h-4" />
                            Have To Do
                        </div>
                        <div className="space-y-2">
                            {haveToDoTasks.map(task => (
                                <div
                                    key={task.id}
                                    draggable
                                    onDragStart={(e) => onDragStart(e, task)}
                                    className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-amber-400 dark:hover:border-amber-500/50 cursor-grab active:cursor-grabbing transition-all hover:shadow-sm"
                                >
                                    <p className="text-sm text-gray-700 dark:text-gray-300 text-left line-clamp-2">{task.text}</p>
                                </div>
                            ))}
                            {haveToDoTasks.length === 0 && (
                                <div className="text-center py-4 text-gray-400 text-xs italic">No tasks</div>
                            )}
                        </div>
                    </div>

                    {/* Want To Do Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-3 text-teal-600 dark:text-teal-500 font-medium text-sm uppercase tracking-wider">
                            <Star className="w-4 h-4" />
                            Want To Do
                        </div>
                        <div className="space-y-2">
                            {wantToDoTasks.map(task => (
                                <div
                                    key={task.id}
                                    draggable
                                    onDragStart={(e) => onDragStart(e, task)}
                                    className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-teal-400 dark:hover:border-teal-500/50 cursor-grab active:cursor-grabbing transition-all hover:shadow-sm"
                                >
                                    <p className="text-sm text-gray-700 dark:text-gray-300 text-left line-clamp-2">{task.text}</p>
                                </div>
                            ))}
                            {wantToDoTasks.length === 0 && (
                                <div className="text-center py-4 text-gray-400 text-xs italic">No tasks</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
