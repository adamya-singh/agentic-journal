'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Calendar, Star, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ListType } from '@/components/TaskLists'; // Reusing type

interface SmartInputProps {
    onAddTask: (text: string, listType: ListType, dueDate?: string) => void;
}

export function SmartInput({ onAddTask }: SmartInputProps) {
    const [text, setText] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Parsing logic for visual feedback
    const isWant = text.toLowerCase().includes('#want');
    // const isHave = text.toLowerCase().includes('#have');
    const isTomorrow = text.toLowerCase().includes('tomorrow');

    // Determine list type based on tags or default
    const targetList: ListType = isWant ? 'want-to-do' : 'have-to-do';

    // Handle keyboard shortcut to focus input
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!text.trim()) return;

        // Clean up text (remove tags)
        let cleanText = text
            .replace(/#want/gi, '')
            .replace(/#have/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Determine due date
        let dueDate: string | undefined = undefined;
        if (isTomorrow) {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            dueDate = d.toISOString().split('T')[0];
            // Note: We keep "tomorrow" in text usually or remove it?
            // For now let's keep it in text unless user explicitly wants magic removal
            // Actually, removing "tomorrow" from text makes it cleaner if it's acting as a command
            cleanText = cleanText.replace(/tomorrow/gi, '').trim();
        }

        onAddTask(cleanText, targetList, dueDate);
        setText('');
    };

    return (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-50">
            <form
                onSubmit={handleSubmit}
                className={cn(
                    "relative flex items-center bg-white dark:bg-gray-800 rounded-2xl shadow-2xl transition-all duration-200 border border-gray-200 dark:border-gray-700 overflow-hidden",
                    isFocused ? "ring-4 ring-indigo-500/20 scale-105" : "scale-100"
                )}
            >
                <div className="pl-4 text-gray-400">
                    {isWant ? <Star className="w-5 h-5 text-teal-500" /> : <ClipboardList className="w-5 h-5 text-amber-500" />}
                </div>

                <input
                    ref={inputRef}
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder="What needs to be done? (Cmd+K)"
                    className="flex-1 px-4 py-4 bg-transparent outline-none text-lg text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                />

                <div className="flex items-center gap-2 pr-4 text-xs font-medium text-gray-500">
                    {/* Visual indicators for parsed tags */}
                    {isTomorrow && (
                        <span className="flex items-center gap-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-full animate-in fade-in zoom-in">
                            <Calendar className="w-3 h-3" /> Tomorrow
                        </span>
                    )}

                    <button
                        type="submit"
                        disabled={!text.trim()}
                        className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-xl transition-colors"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
            </form>

            {/* Helper hints */}
            {isFocused && (
                <div className="absolute top-full left-0 w-full text-center mt-2 text-xs text-gray-400 animate-in fade-in slide-in-from-top-2">
                    Use <span className="text-teal-500 font-mono">#want</span> for desires, default is <span className="text-amber-500 font-mono">#have</span>. Type <span className="text-indigo-400 font-mono">tomorrow</span> to schedule.
                </div>
            )}
        </div>
    );
}
