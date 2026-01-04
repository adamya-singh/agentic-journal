'use client';

import React from 'react';
import { MessageCircle, PanelRight, Type, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

type ChatMode = 'floating' | 'sidepanel' | 'caption';

interface ChatModeSelectorProps {
  currentMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

export function ChatModeSelector({ currentMode, onModeChange }: ChatModeSelectorProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const modes = [
    {
      id: 'caption' as const,
      label: 'Caption',
      icon: <Type className="w-4 h-4" />,
      description: 'Bottom caption style chat',
    },
    {
      id: 'floating' as const,
      label: 'Floating',
      icon: <MessageCircle className="w-4 h-4" />,
      description: 'Resizable floating chat window',
    },
    {
      id: 'sidepanel' as const,
      label: 'Side Panel',
      icon: <PanelRight className="w-4 h-4" />,
      description: 'Dedicated side panel layout',
    },
  ];

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const getThemeIcon = () => {
    if (theme === 'system') return <Monitor className="w-4 h-4" />;
    if (resolvedTheme === 'dark') return <Moon className="w-4 h-4" />;
    return <Sun className="w-4 h-4" />;
  };

  const getThemeLabel = () => {
    if (theme === 'system') return 'System';
    if (theme === 'dark') return 'Dark';
    return 'Light';
  };

  return (
    <div className="absolute top-4 left-4 bg-white/90 dark:bg-gray-800/90 backdrop-blur rounded-lg p-2 shadow-lg border border-gray-200 dark:border-gray-700 z-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold mb-2 text-gray-600 dark:text-gray-300">Chat Modes</div>
          <div className="flex gap-1">
            {modes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => onModeChange(mode.id)}
                className={`
                  flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors
                  ${
                    currentMode === mode.id
                      ? 'bg-blue-500 text-white'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }
                `}
                title={mode.description}
              >
                {mode.icon}
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Theme Toggle */}
        <div>
          <div className="text-xs font-semibold mb-2 text-gray-600 dark:text-gray-300">Theme</div>
          <button
            onClick={cycleTheme}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
            title={`Current: ${getThemeLabel()}. Click to cycle through light/dark/system`}
          >
            {getThemeIcon()}
            {getThemeLabel()}
          </button>
        </div>
      </div>
    </div>
  );
}
