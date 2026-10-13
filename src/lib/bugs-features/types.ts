export const BUG_FEATURE_KINDS = ['bug', 'feature'] as const;
export type BugFeatureKind = (typeof BUG_FEATURE_KINDS)[number];
export type BugFeatureStatus = 'open' | 'shipped';

/** A bug or feature idea saved from the header button, waiting to be handed to Claude Code. */
export interface BugFeature {
  id: string;
  kind: BugFeatureKind;
  description: string;
  /** The user's own draft prompt for Claude Code. */
  prompt: string;
  /** Path + query of the page it was saved from, or null when the user detached it. */
  page: string | null;
  /** Screenshot file names under images/<id>/, in display order. */
  images: string[];
  status: BugFeatureStatus;
  createdAt: string;
  updatedAt: string;
  shippedAt: string | null;
}

export interface BugFeatureView extends BugFeature {
  imageUrls: string[];
  /** Absolute paths on this machine, so Claude Code can read the screenshots directly. */
  imagePaths: string[];
}
