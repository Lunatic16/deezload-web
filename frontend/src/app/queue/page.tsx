"use client";

import { useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, CircleSlash, Clock, Disc3,
  ListMusic, Loader2, Music, Trash2, User, X,
} from "lucide-react";
import { useApp } from "@/components/Providers";
import { timeAgo } from "@/lib/api";
import type { Job, JobStatus, Kind, TrackState } from "@/lib/types";

const KIND_ICON: Record<Kind, typeof Music> = { track: Music, album: Disc3, artist: User, playlist: ListMusic };

const STATUS: Record<JobStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-raised text-dim" },
  running: { label: "Downloading", cls: "bg-accent/15 text-accent" },
  done: { label: "Complete", cls: "bg-ok/15 text-ok" },
  partial: { label: "Partial", cls: "bg-warn/15 text-warn" },
  failed: { label: "Failed", cls: "bg-bad/15 text-bad" },
  cancelled: { label: "Cancelled", cls: "bg-raised text-mute" },
};

function jobProgress(job: Job): number {
  if (job.status === "done") return 100;
  if (!job.tracks.length) return 0;
  const sum = job.tracks.reduce(
    (a, t) => a + (t.status === "done" || t.status === "failed" || t.status === "cancelled" ? 100 : t.pct),
    0,
  );
  return sum / job.tracks.length;
}

function TrackRow({ t }: { t: TrackState }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <span className="w-4 shrink-0">
        {t.status === "done" ? (
          <Check className="h-4 w-4 text-ok" />
        ) : t.status === "failed" ? (
          <AlertTriangle className="h-4 w-4 text-bad" />
        ) : t.status === "cancelled" ? (
          <CircleSlash className="h-4 w-4 text-mute" />
        ) : t.status === "downloading" ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
        ) : (
          <Clock className="h-4 w-4 text-mute" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-fg">{t.title}</div>
        <div className="truncate text-xs text-mute">
          {[t.artist, t.album].filter(Boolean).join(" · ")}
          {t.error && <span className="text-bad"> — {t.error}</span>}
        </div>
      </div>
      {t.format && (
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            t.fallback ? "bg-warn/15 text-warn" : "bg-raised text-dim"
          }`}
          title={t.fallback ? "Fell back to a lower quality than requested" : undefined}
        >
          {t.format}
          {t.fallback ? " ↓" : ""}
        </span>
      )}
      {t.status === "downloading" && (
        <div className="hidden w-28 sm:block">
          <div className="h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${t.pct}%` }} />
          </div>
        </div>
      )}
      {t.status === "downloading" && <span className="w-10 text-right font-mono text-xs text-cyan">{Math.round(t.pct)}%</span>}
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const { cancel } = useApp();
  const [open, setOpen] = useState(job.type === "track" ? false : false);
  const Icon = KIND_ICON[job.type];
  const st = STATUS[job.status];
  const pct = jobProgress(job);
  const total = job.tracks.length;
  const done = job.tracks.filter((t) => t.status === "done").length;
  const failed = job.tracks.filter((t) => t.status === "failed").length;
  const live = job.status === "queued" || job.status === "running";

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <div className={`relative h-14 w-14 shrink-0 overflow-hidden bg-raised ${job.type === "artist" ? "rounded-full" : "rounded-lg"}`}>
          {job.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={job.cover} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            <Icon className="absolute inset-0 m-auto h-5 w-5 text-mute" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{job.title}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
          </div>
          <div className="truncate text-xs text-dim">
            <span className="capitalize">{job.type}</span>
            {job.subtitle && ` · ${job.subtitle}`} · {job.quality.replace("_", " ")} · {timeAgo(job.created)}
          </div>

          {live || job.status === "partial" ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
                <div
                  className={`h-full rounded-full transition-all ${job.status === "partial" ? "bg-warn" : "bg-gradient-to-r from-accent to-violet"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-24 text-right font-mono text-[11px] text-dim">
                {total ? `${done}/${total}` : "preparing…"}
                {failed > 0 && <span className="text-bad"> · {failed} failed</span>}
              </span>
            </div>
          ) : (
            total > 0 && (
              <div className="mt-1 text-xs text-mute">
                {done}/{total} tracks{failed > 0 && <span className="text-bad"> · {failed} failed</span>}
              </div>
            )
          )}
          {job.error && <div className="mt-1 text-xs text-bad">{job.error}</div>}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {live && (
            <button className="btn-ghost !px-2" onClick={() => cancel(job.id)} title="Cancel">
              <X className="h-4 w-4" />
            </button>
          )}
          {total > 0 && (
            <button className="btn-ghost !px-2" onClick={() => setOpen((o) => !o)} title="Show tracks">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {open && total > 0 && (
        <div className="max-h-96 divide-y divide-line/40 overflow-y-auto border-t border-line/60 bg-panel/50">
          {job.tracks.map((t, i) => (
            <TrackRow key={`${t.id}-${i}`} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function QueuePage() {
  const { jobs, clearFinished } = useApp();
  const hasFinished = jobs.some((j) => !["queued", "running"].includes(j.status));

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="mt-1 text-sm text-dim">Jobs run one at a time; tracks within a job download in parallel.</p>
        </div>
        {hasFinished && (
          <button className="btn-ghost" onClick={clearFinished}>
            <Trash2 className="h-4 w-4" /> Clear finished
          </button>
        )}
      </header>

      {jobs.length === 0 ? (
        <div className="panel grid place-items-center gap-2 px-4 py-14 text-center">
          <Clock className="h-8 w-8 text-mute" />
          <p className="text-sm text-dim">Nothing here yet. Queue something from Search.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      )}
    </div>
  );
}
