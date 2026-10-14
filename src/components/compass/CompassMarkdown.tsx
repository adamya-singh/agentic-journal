'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Markdown for compass text. Scoped by .cp-md in CP_CSS; the `prose` classes TaskNotesPreview uses
// do nothing here because @tailwindcss/typography is not installed.
export function CompassMarkdown({ markdown, className = '' }: { markdown: string; className?: string }) {
  return (
    <div className={`cp-md ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          table: ({ children }) => (
            <div style={{ overflowX: 'auto' }}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
