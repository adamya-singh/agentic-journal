'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { ChatModeSelector, ChatMode } from '@/components/ChatModeSelector';

interface SettingsPopoverProps {
  currentMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

export function SettingsPopover({ currentMode, onModeChange }: SettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Settings"
        className="flex items-center p-1.5 rounded-md bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm transition-colors"
      >
        <Settings className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 min-w-max bg-white/95 dark:bg-gray-800/95 backdrop-blur rounded-lg p-3 shadow-lg border border-gray-200 dark:border-gray-700">
          <ChatModeSelector currentMode={currentMode} onModeChange={onModeChange} />
        </div>
      )}
    </div>
  );
}
