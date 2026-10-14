// Plain YouTube URL helpers, kept apart from youtube.ts so the media API route
// does not pull the browser automation (playwright-core) into its bundle.
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const thumbnailUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
export const watchUrl = (videoId: string, short?: boolean) =>
  short
    ? `https://www.youtube.com/shorts/${videoId}`
    : `https://www.youtube.com/watch?v=${videoId}`;
