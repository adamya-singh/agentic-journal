import type { BugFeatureKind } from './types';

export interface PromptSource {
  kind: BugFeatureKind;
  description: string;
  prompt: string;
  page: string | null;
  createdAt: string;
  /** Absolute paths once saved; for an unsaved draft, pass one placeholder per screenshot. */
  imagePaths: string[];
}

function formatSaved(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The text "Copy for Claude Code" puts on the clipboard: the user's prompt first, then the context. */
export function claudeCodePrompt(source: PromptSource): string {
  const lines = [
    source.prompt.trim() ||
      'No prompt was drafted for this one. Read the description and screenshots, then propose a fix before changing anything.',
    '',
    '## Context',
    `- Kind: ${source.kind === 'bug' ? 'Bug' : 'Feature'}`,
  ];
  if (source.page) lines.push(`- Page: ${source.page}`);
  lines.push(`- Saved: ${formatSaved(source.createdAt)}`);
  if (source.description.trim()) lines.push('', '## What I saw', source.description.trim());
  if (source.imagePaths.length) {
    lines.push('', '## Screenshots (read these first)', ...source.imagePaths.map((p) => `- ${p}`));
  }
  return lines.join('\n');
}
