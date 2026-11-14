// The open task lives in the home page's address: /?task=<id>[&tab=brief|chat]. A task's id is its own; an
// action card's is its card id (ac_…), which Sunrise's engine knows as `card:ac_…`. On a phone `tab` is the
// workspace's tab (Work, the default, is left out); on a wide screen it opens that column.

export type TaskTab = 'brief' | 'work' | 'chat';
export interface TaskInUrl { task: string | null; tab: TaskTab | null }

const KEYS = new Set(['task', 'tab']);
const enc = (value: string) => encodeURIComponent(value).replace(/%3A/gi, ':');
const dec = (value: string) => { try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return value; } };

/** Sunrise's engine id for the id in an address: a card id gets its `card:` prefix. */
export const engineTaskId = (id: string) => (id.startsWith('ac_') ? `card:${id}` : id);
/** The id an address carries for one of the engine's ids. */
export const urlTaskId = (id: string) => (id.startsWith('card:') ? id.slice(5) : id);

/** The task and tab a search string (with or without its `?`) names. Work, the default tab, reads as null. */
export function parseTaskSearch(search: string): TaskInUrl {
  const params = new URLSearchParams(search);
  const task = params.get('task')?.trim() || null;
  const tab = params.get('tab');
  return { task, tab: task && (tab === 'brief' || tab === 'chat') ? tab : null };
}

/**
 * The search string (`?…`, or '' when nothing is left) for `search` with its task set to `task` (null takes it
 * out) and its tab to `tab` (Work, or none, leaves it out). Every other parameter stays as it was written.
 */
export function taskSearch(search: string, task: string | null, tab?: TaskTab | null): string {
  const kept = search.replace(/^\?/, '').split('&').filter((part) => part !== '' && !KEYS.has(dec(part.split('=')[0])));
  if (task) {
    kept.push(`task=${enc(task)}`);
    if (tab === 'brief' || tab === 'chat') kept.push(`tab=${tab}`);
  }
  return kept.length ? `?${kept.join('&')}` : '';
}

/** A link that opens a task (or an action card, by its ac_ id) on the home page, on a tab if given. */
export const taskLink = (id: string, tab?: TaskTab | null) => `/${taskSearch('', urlTaskId(id), tab)}`;
