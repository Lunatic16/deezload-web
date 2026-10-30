export type Kind = "track" | "album" | "artist" | "playlist";
export type QualityId = "FLAC" | "MP3_320" | "MP3_128";

export interface SearchItem {
  id: string;
  type: Kind;
  title: string;
  subtitle: string;
  cover: string | null;
  meta: string;
}

export type TrackStatus = "queued" | "downloading" | "done" | "failed" | "cancelled";

export interface TrackState {
  id: string;
  title: string;
  artist: string;
  album: string;
  status: TrackStatus;
  pct: number;
  format: "FLAC" | "MP3" | null;
  fallback: boolean;
  error: string | null;
}

export type JobStatus = "queued" | "running" | "done" | "partial" | "failed" | "cancelled";

export interface Job {
  id: string;
  type: Kind;
  content_id: string;
  title: string;
  subtitle: string;
  cover: string | null;
  quality: QualityId;
  status: JobStatus;
  error: string | null;
  tracks: TrackState[];
  created: number;
  started: number | null;
  finished: number | null;
}

export interface Status {
  configured: boolean;
  authenticated: boolean;
  user: string | null;
  error: string | null;
}

export interface Settings {
  quality: QualityId;
  min_quality: "" | QualityId;
  concurrency: number;
  retries: number;
  lyrics: boolean;
  arl_set: boolean;
  arl_hint: string;
  arl_from_env: boolean;
}

export interface LibraryItem {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  mtime: number;
  ext: string;
}
