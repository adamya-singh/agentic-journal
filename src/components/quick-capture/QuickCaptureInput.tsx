'use client';

import React from 'react';
import { Zap } from 'lucide-react';
import { useQuickCapture } from './QuickCaptureProvider';

interface QuickCaptureInputProps {
  variant: 'inline' | 'overlay';
  autoFocus?: boolean;
}

export function QuickCaptureInput({ variant, autoFocus }: QuickCaptureInputProps) {
  const { submitCapture } = useQuickCapture();
  const [value, setValue] = React.useState('');

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    submitCapture(trimmed);
    setValue('');
  };

  const sizing =
    variant === 'overlay' ? 'px-4 py-3 text-base' : 'px-3.5 py-2 text-sm';

  return (
    <div className="relative">
      <Zap
        className={`absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 ${
          variant === 'overlay' ? 'w-5 h-5' : 'w-4 h-4'
        }`}
      />
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
        placeholder="Capture a thought… (⌘K)"
        className={`w-full ${sizing} pl-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-indigo-500 focus:border-transparent transition-shadow`}
      />
    </div>
  );
}
