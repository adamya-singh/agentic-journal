export type Collection = 'watched' | 'ratings' | 'watchlist';
export interface MediaTitle {
  id: string;
  title: string;
  url: string;
  year?: string;
  type?: string;
  poster?: string;
  genres?: string[];
  imdbRating?: number;
  yourRating?: number | null;
  watched?: boolean;
  watchlist?: boolean;
  collections: Collection[];
  reason?: string;
}
export interface Coverage {
  total: number | null;
  collected: number;
  complete: boolean;
  at: string;
}
export type MediaAction = 'sync' | 'seen' | 'watchlist' | 'rating';
export interface MediaJob {
  id: string;
  action: MediaAction;
  titleId?: string;
  rating?: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
  finishedAt?: string;
  error?: string;
}
export interface MediaState {
  version: 1;
  account?: { id: string; name: string };
  titles: Record<string, MediaTitle>;
  recommendations: string[];
  feedback: Record<string, 'interested' | 'dismissed'>;
  coverage: Partial<Record<Collection, Coverage>>;
  jobs: MediaJob[];
  syncedAt?: string;
  workerAt?: string;
  warning?: string;
}
export interface MediaView extends Omit<MediaState, 'titles'> {
  library: MediaTitle[];
  picks: MediaTitle[];
  dismissed: MediaTitle[];
}
