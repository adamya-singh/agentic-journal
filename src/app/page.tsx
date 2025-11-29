'use client';

import React from 'react';
import { z } from 'zod';
import {
  useRegisterState,
  useRegisterFrontendTool,
  useSubscribeStateToAgentContext,
  useCedarStore,
} from 'cedar-os';

import { ChatModeSelector } from '@/components/ChatModeSelector';
import { WeekView } from '@/components/WeekView';
import { TaskLists } from '@/components/TaskLists';
import { CedarCaptionChat } from '@/cedar/components/chatComponents/CedarCaptionChat';
import { FloatingCedarChat } from '@/cedar/components/chatComponents/FloatingCedarChat';
import { SidePanelCedarChat } from '@/cedar/components/chatComponents/SidePanelCedarChat';
import { DebuggerPanel } from '@/cedar/components/debugger';

type ChatMode = 'floating' | 'sidepanel' | 'caption';

/**
 * Get current date in MMDDYY format
 */
function getCurrentDateMMDDYY(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  return `${month}${day}${year}`;
}

/**
 * Get current time in 12-hour format (e.g., 3:45 PM)
 */
function getCurrentTime(): string {
  const now = new Date();
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes} ${ampm}`;
}

export default function HomePage() {
  // Cedar-OS chat components with mode selector
  // Choose between caption, floating, or side panel chat modes
  const [chatMode, setChatMode] = React.useState<ChatMode>('sidepanel');

  // Cedar state for the main text that can be changed by the agent
  const [mainText, setMainText] = React.useState('tell Cedar to change me');

  // Cedar state for dynamically added text lines
  const [textLines, setTextLines] = React.useState<string[]>([]);

  // Cedar state for current date in MMDDYY format
  const [currentDate, setCurrentDate] = React.useState(getCurrentDateMMDDYY());

  // Cedar state for current time
  const [currentTime, setCurrentTime] = React.useState(getCurrentTime());

  // State for journal creation button
  const [journalStatus, setJournalStatus] = React.useState<'idle' | 'loading' | 'success' | 'error' | 'exists'>('idle');
  const [journalMessage, setJournalMessage] = React.useState<string>('');

  // Get setShowChat to ensure chat is visible on load
  const setShowChat = useCedarStore((state) => state.setShowChat);

  // System message to pre-fill in chat input when page loads
  const systemMessage = `[System] The user has opened the journal page. Current date: ${currentDate}, Current time: ${currentTime}. Read today's journal using the readJournal tool and ask the user terse, efficient questions to help fill in the journal entries for the day. If any entries already exist for today, don't try to fill in any gaps before the latest entry.`;

  // Ensure chat panel is visible on load
  React.useEffect(() => {
    setShowChat(true);
  }, [setShowChat]);

  // Register the main text as Cedar state with a state setter
  useRegisterState({
    key: 'mainText',
    description: 'The main text that can be modified by Cedar',
    value: mainText,
    setValue: setMainText,
    stateSetters: {
      changeText: {
        name: 'changeText',
        description: 'Change the main text to a new value',
        argsSchema: z.object({
          newText: z.string().min(1, 'Text cannot be empty').describe('The new text to display'),
        }),
        execute: (
          currentText: string,
          setValue: (newValue: string) => void,
          args: { newText: string },
        ) => {
          setValue(args.newText);
        },
      },
    },
  });

  // Register the current date as Cedar state
  useRegisterState({
    key: 'currentDate',
    description: 'The current date in MMDDYY format (e.g., 112525 for November 25, 2025)',
    value: currentDate,
    setValue: setCurrentDate,
  });

  // Register the current time as Cedar state
  useRegisterState({
    key: 'currentTime',
    description: 'The current time in 12-hour format (e.g., 3:45 PM)',
    value: currentTime,
    setValue: setCurrentTime,
  });

  // Subscribe the main text state to the backend
  useSubscribeStateToAgentContext('mainText', (mainText) => ({ mainText }), {
    showInChat: true,
    color: '#4F46E5',
  });

  // Subscribe the current date to agent context
  useSubscribeStateToAgentContext('currentDate', (currentDate) => ({ currentDate }), {
    showInChat: false,
  });

  // Subscribe the current time to agent context
  useSubscribeStateToAgentContext('currentTime', (currentTime) => ({ currentTime }), {
    showInChat: false,
  });

  // Handler for creating today's journal
  const handleCreateTodayJournal = async () => {
    setJournalStatus('loading');
    setJournalMessage('');
    
    try {
      const response = await fetch('/api/journal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: currentDate }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        if (data.alreadyExists) {
          setJournalStatus('exists');
          setJournalMessage(`Journal for ${currentDate} already exists`);
        } else {
          setJournalStatus('success');
          setJournalMessage(`Created journal for ${currentDate}`);
        }
      } else {
        setJournalStatus('error');
        setJournalMessage(data.error || 'Failed to create journal');
      }
    } catch (error) {
      setJournalStatus('error');
      setJournalMessage('Failed to connect to server');
    }
  };


  // Register frontend tool for adding text lines
  useRegisterFrontendTool({
    name: 'addNewTextLine',
    description: 'Add a new line of text to the screen via frontend tool',
    argsSchema: z.object({
      text: z.string().min(1, 'Text cannot be empty').describe('The text to add to the screen'),
      style: z
        .enum(['normal', 'bold', 'italic', 'highlight'])
        .optional()
        .describe('Text style to apply'),
    }),
    execute: async (args: { text: string; style?: 'normal' | 'bold' | 'italic' | 'highlight' }) => {
      const styledText =
        args.style === 'bold'
          ? `**${args.text}**`
          : args.style === 'italic'
            ? `*${args.text}*`
            : args.style === 'highlight'
              ? `🌟 ${args.text} 🌟`
              : args.text;
      setTextLines((prev) => [...prev, styledText]);
    },
  });

  const renderContent = () => (
    <div className="relative min-h-screen w-full">
      <ChatModeSelector currentMode={chatMode} onModeChange={setChatMode} />

      {/* Week View */}
      <div className="pt-16 pb-4">
        <WeekView />
      </div>

      {/* Task Lists */}
      <TaskLists />

      {/* Main interactive content area */}
      <div className="flex flex-col items-center justify-center p-8 space-y-8">
        {/* Journal creation section */}
        <div className="flex flex-col items-center gap-3">
          <div className="text-sm text-gray-500">
            Today: {currentDate}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreateTodayJournal}
              disabled={journalStatus === 'loading'}
              className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                journalStatus === 'loading'
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : journalStatus === 'success'
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : journalStatus === 'exists'
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : journalStatus === 'error'
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : 'bg-indigo-500 text-white hover:bg-indigo-600'
              }`}
            >
              {journalStatus === 'loading'
                ? 'Creating...'
                : journalStatus === 'success'
                  ? '✓ Created'
                  : journalStatus === 'exists'
                    ? '✓ Already Exists'
                    : journalStatus === 'error'
                      ? 'Retry'
                      : "Create Today's Journal"}
            </button>
          </div>
          {journalMessage && (
            <p className={`text-sm ${journalStatus === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
              {journalMessage}
            </p>
          )}
        </div>

        {/* Big text that Cedar can change */}
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-800 mb-4">{mainText}</h1>
          <p className="text-lg text-gray-600 mb-8">
            This text can be changed by Cedar using state setters
          </p>
        </div>

        {/* Instructions for adding new text */}
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-700 mb-2">
            tell cedar to add new lines of text to the screen
          </h2>
          <p className="text-md text-gray-500 mb-6">
            Cedar can add new text using frontend tools with different styles
          </p>
        </div>

        {/* Display dynamically added text lines */}
        {textLines.length > 0 && (
          <div className="w-full max-w-2xl">
            <h3 className="text-xl font-medium text-gray-700 mb-4 text-center">Added by Cedar:</h3>
            <div className="space-y-2">
              {textLines.map((line, index) => (
                <div
                  key={index}
                  className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-center"
                >
                  {line.startsWith('**') && line.endsWith('**') ? (
                    <strong className="text-blue-800">{line.slice(2, -2)}</strong>
                  ) : line.startsWith('*') && line.endsWith('*') ? (
                    <em className="text-blue-700">{line.slice(1, -1)}</em>
                  ) : line.startsWith('🌟') ? (
                    <span className="text-yellow-600 font-semibold">{line}</span>
                  ) : (
                    <span className="text-blue-800">{line}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {chatMode === 'caption' && <CedarCaptionChat />}

      {chatMode === 'floating' && (
        <FloatingCedarChat side="right" title="Cedarling Chat" collapsedLabel="Chat with Cedar" />
      )}
    </div>
  );

  if (chatMode === 'sidepanel') {
    return (
      <SidePanelCedarChat
        side="right"
        title="Cedarling Chat"
        collapsedLabel="Chat with Cedar"
        showCollapsedButton={true}
        initialMessage={systemMessage}
      >
        <DebuggerPanel />
        {renderContent()}
      </SidePanelCedarChat>
    );
  }

  return renderContent();
}
