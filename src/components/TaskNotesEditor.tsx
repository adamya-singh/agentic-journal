'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';

type EditorMode = 'rich' | 'markdown';

interface TaskNotesEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function TaskNotesEditor({
  value,
  onChange,
  placeholder = 'Add markdown notes (links, tables, bullets, etc.)',
}: TaskNotesEditorProps) {
  const [mode, setMode] = useState<EditorMode>('rich');
  const normalizedValue = useMemo(() => normalizeMarkdown(value), [value]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        autolink: true,
        openOnClick: false,
        protocols: ['http', 'https', 'mailto'],
      }),
      Placeholder.configure({
        placeholder,
      }),
      Markdown,
    ],
    content: normalizedValue,
    contentType: 'markdown',
    immediatelyRender: false,
    onUpdate: ({ editor: updatedEditor }) => {
      const next = normalizeMarkdown(updatedEditor.getMarkdown());
      onChange(next);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = normalizeMarkdown(editor.getMarkdown());
    if (current !== normalizedValue) {
      editor.commands.setContent(normalizedValue, { contentType: 'markdown' });
    }
  }, [editor, normalizedValue]);

  const applyLink = () => {
    if (!editor) return;
    const currentHref = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Enter link URL', currentHref ?? 'https://');

    if (url === null) return;

    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().setLink({ href: trimmed }).run();
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode('rich')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              mode === 'rich'
                ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Rich
          </button>
          <button
            type="button"
            onClick={() => setMode('markdown')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              mode === 'markdown'
                ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Markdown
          </button>
        </div>

        {mode === 'rich' && editor && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('bold') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              title="Bold"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('italic') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              title="Italic"
            >
              I
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('code') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              title="Inline code"
            >
              {'</>'}
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('bulletList') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              title="Bullet list"
            >
              • List
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('orderedList') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              title="Numbered list"
            >
              1. List
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('blockquote') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              title="Blockquote"
            >
              Quote
            </button>
            <button
              type="button"
              onClick={applyLink}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('link') ? 'bg-gray-200 dark:bg-gray-600' : 'hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              title="Link"
            >
              Link
            </button>
          </div>
        )}
      </div>

      {mode === 'rich' ? (
        <EditorContent
          editor={editor}
          className="min-h-[180px] max-h-[280px] overflow-y-auto px-4 py-3 text-sm text-gray-800 dark:text-gray-100 [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[150px] [&_.ProseMirror]:whitespace-pre-wrap"
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(normalizeMarkdown(e.target.value))}
          rows={8}
          placeholder={placeholder}
          className="w-full min-h-[180px] max-h-[280px] px-4 py-3 text-sm font-mono border-0 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none resize-y"
        />
      )}
    </div>
  );
}
