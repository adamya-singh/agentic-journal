#!/usr/bin/env node
import { localKey } from '../src/lib/bookmarks/x-client.ts';
const [command = 'help', ...args] = process.argv.slice(2);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  if (!args[i].startsWith('--') || !args[i + 1]) {
    console.error(JSON.stringify({ success: false, error: 'Options require --name value.' }));
    process.exit(1);
  }
  options.set(args[i].slice(2), args[i + 1]);
}
if (command === 'help') {
  console.log(
    JSON.stringify(
      {
        commands: [
          'list [--q text] [--tag tag] [--folder id|none] [--author username] [--sort saved|saved-oldest|posted|posted-oldest|author] [--unread true] [--favorite true] [--media photo|video|link|text] [--offset N] [--limit N]',
          'search --q text',
          'get --key account:post',
          'update --key account:post [--favorite true|false] [--read true|false] [--tags tag1,tag2]',
          'sync',
          'folders',
          'status',
          'cancel',
          'resume',
        ],
        note: 'Only sync/resume/folders call X. Configure connection and billing at /bookmarks.',
      },
      null,
      2,
    ),
  );
} else {
  try {
    if (
      ![
        'list',
        'search',
        'get',
        'update',
        'sync',
        'folders',
        'status',
        'cancel',
        'resume',
      ].includes(command)
    )
      throw new Error('Unknown command. Use help.');
    const base = process.env.AGENTIC_JOURNAL_URL || 'http://127.0.0.1:3000';
    const endpoint =
      command === 'list' || command === 'search'
        ? ''
        : command === 'get' || command === 'update'
          ? '/item'
          : `/${command}`;
    const url = new URL(`/api/bookmarks${endpoint}`, base);
    const write = ['update', 'sync', 'folders', 'cancel', 'resume'].includes(command);
    let body: Record<string, unknown> | undefined;
    if (command === 'update') {
      body = { key: options.get('key') };
      for (const field of ['read', 'favorite'])
        if (options.has(field)) {
          if (!['true', 'false'].includes(options.get(field)!))
            throw new Error(`${field} must be true or false.`);
          body[field] = options.get(field) === 'true';
        }
      if (options.has('tags'))
        body.tags = options
          .get('tags')!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    } else if (!write) for (const [key, value] of options) url.searchParams.set(key, value);
    const response = await fetch(url, {
      method: write ? 'POST' : 'GET',
      headers: {
        ...(write ? { Authorization: `Bearer ${await localKey()}` } : {}),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(command === 'folders' ? 300_000 : 15_000),
    });
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
    if (!response.ok) process.exitCode = 1;
  } catch (e) {
    console.error(
      JSON.stringify({
        success: false,
        error: e instanceof Error ? e.message : 'Bookmark command failed.',
      }),
    );
    process.exitCode = 1;
  }
}
