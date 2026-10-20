// Whether a link lands on the thing itself or on a hub you still have to search from. A brief's Start here
// button and an action card's link should open the assignment, the form or the doc, so a course home or
// a site's front page only stands in when nothing more direct is known. Pure, shared by briefs and cards.

// Canvas (and Gradescope) course pages that list things rather than being one: /courses/123,
// /courses/123/assignments, /courses/123/modules, ...
const COURSE_HUB = /^\/courses\/\d+(?:\/(?:assignments(?:\/syllabus)?|modules|quizzes|discussion_topics|announcements|pages|files|grades|syllabus|users|external_tools))?\/?$/;

/** True for a course home or list page, or a site's bare front page. False for anything deeper, and for non-URLs. */
export function isGenericLink(href: string | undefined | null): boolean {
  if (!href) return false;
  let url: URL;
  try { url = new URL(href); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return !url.search && !url.hash;
  return COURSE_HUB.test(path);
}

/** A Canvas link to one assignment, quiz, discussion or module item: what "Open it on Canvas" should open. */
export function isCanvasItemLink(href: string | undefined | null): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    return /instructure\.com$|canvas\.rutgers\.edu$/.test(url.hostname)
      && /^\/courses\/\d+\/(assignments|quizzes|discussion_topics|modules\/items)\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}
