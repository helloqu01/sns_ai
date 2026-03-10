export type InstagramPublishingStatus =
  | "queued"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type InstagramPublishMode = "now" | "scheduled";

export interface InstagramPublishingRecord {
  id: string;
  status: InstagramPublishingStatus;
  publishMode: InstagramPublishMode;
  caption: string;
  imageUrl: string;
  scheduledFor: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  failedAt: string | null;
  festivalId: string | null;
  festivalTitle: string | null;
  accountId: string | null;
  igUserId: string | null;
  igUsername: string | null;
  pageName: string | null;
  mediaContainerId: string | null;
  mediaPublishId: string | null;
  permalink: string | null;
  lastError: string | null;
}
