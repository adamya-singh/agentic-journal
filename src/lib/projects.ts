import { Task } from '@/lib/types';

export function normalizeProjectSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeProjectList(input?: string[]): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const unique = new Set<string>();
  for (const value of input) {
    if (typeof value !== 'string') {
      continue;
    }
    const slug = normalizeProjectSlug(value);
    if (slug.length > 0) {
      unique.add(slug);
    }
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

export function formatProjectTag(slug: string): string {
  return `(${slug})`;
}

export function formatTaskTextWithProjects(task: Pick<Task, 'text' | 'projects'>): string {
  const projects = normalizeProjectList(task.projects);
  if (projects.length === 0) {
    return task.text;
  }

  const tagPrefix = projects.map((project) => formatProjectTag(project)).join(' ');
  return `${tagPrefix} ${task.text}`;
}
