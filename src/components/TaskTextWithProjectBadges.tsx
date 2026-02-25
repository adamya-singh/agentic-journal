import React from 'react';
import { formatProjectTag, normalizeProjectList } from '@/lib/projects';

interface TaskTextWithProjectBadgesProps {
  text: string;
  projects?: string[];
  className?: string;
  textClassName?: string;
  badgeClassName?: string;
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function TaskTextWithProjectBadges({
  text,
  projects,
  className,
  textClassName,
  badgeClassName,
}: TaskTextWithProjectBadgesProps) {
  const mergedProjects = normalizeProjectList(projects);

  return (
    <span className={className}>
      {mergedProjects.map((project) => (
        <span
          key={project}
          className={joinClassNames(
            'inline-flex items-center align-middle mr-1 px-2 py-0.5 rounded bg-teal-100/90 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-medium',
            badgeClassName
          )}
        >
          {formatProjectTag(project)}
        </span>
      ))}
      <span className={textClassName}>{text}</span>
    </span>
  );
}
