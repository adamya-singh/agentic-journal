// The sections under the sun: where a want-to-do task belongs. Two are permanent and always drawn, with or without
// tasks in them; everything else on the want side is Life, unless the task carries its own "[Label]".
// A task is in a track when its text starts with the track's name in brackets ("[Level Up] CUDA project", or one of
// the track's other names), or when one of its projects is listed for the track in tasks/want-tracks.json.
// Pure: no filesystem, so the loader and the tests share it.
import type { Task } from '@/lib/types';

export interface WantTrack {
  name: string;
  about: string;          // what belongs here, in his words
  names: string[];        // other bracket labels that mean this track, lower case
  projects: string[];     // project slugs whose tasks belong here
}

export const TRACK_RECHARGE = 'Recharge', TRACK_LEVEL_UP = 'Level Up', TRACK_LIFE = 'Life';

export const PERMANENT_TRACKS: readonly WantTrack[] = [
  {
    name: TRACK_RECHARGE,
    about: 'Projects and things done only because he enjoys them: what leaves him fulfilled instead of drained, and keeps him sane while grinding.',
    names: ['recharge', 'joy', 'fun', 'enjoy', 'sanity'],
    projects: [],
  },
  {
    name: TRACK_LEVEL_UP,
    about: 'Projects and study that level him up as a real-world machine learning engineer.',
    names: ['level up', 'levelup', 'leveling', 'mle'],
    projects: [],
  },
];

const slug = (value: string) => value.trim().toLowerCase();

/** The tracks with the projects the stored file lists for them. Anything else in the file is ignored. */
export function readWantTracks(raw: unknown): WantTrack[] {
  const stored = raw && typeof raw === 'object' && Array.isArray((raw as { tracks?: unknown }).tracks) ? (raw as { tracks: unknown[] }).tracks : [];
  return PERMANENT_TRACKS.map((track) => {
    const hit = stored.find((entry) => !!entry && typeof entry === 'object' && slug(String((entry as { name?: unknown }).name ?? '')) === slug(track.name)) as { projects?: unknown } | undefined;
    const projects = Array.isArray(hit?.projects) ? hit.projects.filter((p): p is string => typeof p === 'string').map(slug).filter(Boolean) : [];
    return { ...track, projects: [...new Set(projects)] };
  });
}

/** The section a want-to-do task sits in: a permanent track, its own "[Label]", or Life. */
export function trackFor(task: Pick<Task, 'projects'>, label: string, tracks: readonly WantTrack[] = PERMANENT_TRACKS): string {
  const named = slug(label);
  if (named) return tracks.find((track) => slug(track.name) === named || track.names.includes(named))?.name ?? label;
  const projects = (task.projects ?? []).map(slug);
  return tracks.find((track) => track.projects.some((p) => projects.includes(p)))?.name ?? TRACK_LIFE;
}

/** The sections in the order they are drawn: the permanent ones, then his own labels, then Life. */
export function trackOrder(names: Iterable<string>, tracks: readonly WantTrack[] = PERMANENT_TRACKS): string[] {
  const fixed = tracks.map((track) => track.name);
  const own = [...new Set(names)].filter((name) => !fixed.includes(name) && name !== TRACK_LIFE).sort((a, b) => a.localeCompare(b));
  return [...fixed, ...own, TRACK_LIFE];
}
