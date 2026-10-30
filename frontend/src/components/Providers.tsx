"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { api } from "@/lib/api";
import type { Job, Kind, Status } from "@/lib/types";

type ToastKind = "ok" | "error" | "info";
interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
}

interface Ctx {
  jobs: Job[];
  status: Status | null;
  activeKeys: Set<string>;
  activeCount: number;
  refreshStatus: () => Promise<void>;
  refreshJobs: () => Promise<void>;
  enqueue: (type: Kind, id: string, title: string, quality?: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
  toast: (msg: string, kind?: ToastKind) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside <Providers>");
  return c;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const activeRef = useRef(false);
  const seq = useRef(0);

  const toast = useCallback((msg: string, kind: ToastKind = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const j = await api.jobs();
      activeRef.current = j.some((x) => x.status === "queued" || x.status === "running");
      setJobs(j);
    } catch {
      /* transient — next poll will retry */
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {
      setStatus({ configured: false, authenticated: false, user: null, error: "Backend unreachable" });
    }
  }, []);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refreshJobs();
      if (!stop) timer = setTimeout(tick, activeRef.current ? 1000 : 4000);
    };
    tick();
    refreshStatus();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [refreshJobs, refreshStatus]);

  const enqueue = useCallback(
    async (type: Kind, id: string, title: string, quality?: string) => {
      try {
        await api.createJob(type, id, quality);
        toast(`Queued “${title}”`, "ok");
        activeRef.current = true;
        await refreshJobs();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [refreshJobs, toast],
  );

  const cancel = useCallback(
    async (id: string) => {
      try {
        await api.cancelJob(id);
        await refreshJobs();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [refreshJobs, toast],
  );

  const clearFinished = useCallback(async () => {
    try {
      await api.clearJobs();
      await refreshJobs();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [refreshJobs, toast]);

  const activeKeys = useMemo(
    () =>
      new Set(
        jobs.filter((j) => j.status === "queued" || j.status === "running").map((j) => `${j.type}:${j.content_id}`),
      ),
    [jobs],
  );
  const activeCount = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running").length,
    [jobs],
  );

  const value: Ctx = {
    jobs, status, activeKeys, activeCount,
    refreshStatus, refreshJobs, enqueue, cancel, clearFinished, toast,
  };

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-20 right-4 z-50 flex flex-col gap-2 md:bottom-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm animate-slideUp items-start gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm shadow-xl"
          >
            {t.kind === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
            ) : t.kind === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            )}
            <span className="text-fg">{t.msg}</span>
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
