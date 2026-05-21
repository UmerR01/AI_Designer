"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/auth-api";
import type { DesignerProject } from "@/lib/designer-projects";
import { formatProjectDate } from "@/lib/designer-projects";

export function useDesignerProjects(status: "active" | "deleted" = "active") {
  const [projects, setProjects] = useState<DesignerProject[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadOnce = async () => {
      const res = await getJson<{ projects: { id: string; name: string; kind: string; created_at: string; updated_at: string }[] }>(
        `/api/projects?status=${status}`
      );
      if (cancelled) return;
      setProjects(
        res.projects.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind as any,
          sizeText: "0 GB",
          dateText: formatProjectDate(new Date(p.updated_at ?? p.created_at)),
        }))
      );
    };

    (async () => {
      try {
        await loadOnce();
      } catch {
        // Retry once for transient auth/network race during boot.
        try {
          await new Promise((r) => setTimeout(r, 350));
          await loadOnce();
        } catch {
          // Keep current client state instead of wiping the list to empty.
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const createProject = useCallback(async (name: string, kind?: string) => {
    const res = await postJson<{ project: { id: string; name: string; kind: string; created_at: string; updated_at: string } }>(
      "/api/projects",
      { name, kind }
    );
    const p: DesignerProject = {
      id: res.project.id,
      name: res.project.name,
      kind: res.project.kind as any,
      sizeText: "0 GB",
      dateText: formatProjectDate(new Date(res.project.updated_at ?? res.project.created_at)),
    };
    setProjects((prev) => [p, ...prev]);
    return p;
  }, []);

  const removeProject = useCallback(async (id: string, permanent: boolean = false) => {
    try {
      await fetch(`/api/projects/${id}${permanent ? '?permanent=true' : ''}`, { method: 'DELETE' });
    } catch {
      // Ignore
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const updateProject = useCallback(async (id: string, patch: Partial<DesignerProject> & { restore?: boolean }) => {
    try {
      await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch {
      // Ignore
    }
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  return { projects, setProjects, createProject, removeProject, updateProject, hydrated };
}
