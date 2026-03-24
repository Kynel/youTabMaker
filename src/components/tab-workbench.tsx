"use client";

import { useEffect, useRef, useState } from "react";

import { FrameSelectionLab } from "@/components/frame-selection-lab";
import { YouTubeIntakeForm } from "@/components/youtube-intake-form";
import type { DraftProject } from "@/lib/types";

const LAST_PROJECT_STORAGE_KEY = "youtabmaker:last-project-id";

export function TabWorkbench() {
  const [project, setProject] = useState<DraftProject | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const captureRequestIdRef = useRef(0);

  async function captureFrames(projectToCapture: DraftProject) {
    const requestId = captureRequestIdRef.current + 1;
    captureRequestIdRef.current = requestId;

    setIsCapturing(true);
    setCaptureError(null);

    try {
      const response = await fetch(`/api/projects/${projectToCapture.id}/capture`, {
        method: "POST"
      });

      const payload = (await response.json().catch(() => null)) as
        | { project?: DraftProject; error?: string }
        | null;

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error ?? "Failed to capture frames from the YouTube video.");
      }

      if (captureRequestIdRef.current !== requestId) {
        return;
      }

      setProject(payload.project);
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, payload.project.id);
    } catch (error) {
      if (captureRequestIdRef.current !== requestId) {
        return;
      }

      setCaptureError(
        error instanceof Error ? error.message : "Failed to capture frames from the YouTube video."
      );
    } finally {
      if (captureRequestIdRef.current === requestId) {
        setIsCapturing(false);
      }
    }
  }

  useEffect(() => {
    async function restoreProject() {
      const lastProjectId = window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);

      if (!lastProjectId) {
        setIsRestoring(false);
        return;
      }

      try {
        const response = await fetch(`/api/projects/${lastProjectId}`);
        const payload = (await response.json().catch(() => null)) as { project?: DraftProject } | null;

        if (response.ok && payload?.project) {
          setProject(payload.project);

          if (!payload.project.frames || payload.project.frames.length === 0) {
            await captureFrames(payload.project);
          }
        }
      } finally {
        setIsRestoring(false);
      }
    }

    void restoreProject();
  }, []);

  function handleProjectCreated(nextProject: DraftProject) {
    setProject(nextProject);
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, nextProject.id);
    void captureFrames(nextProject);
  }

  function handleProjectUpdated(nextProject: DraftProject) {
    setProject(nextProject);
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, nextProject.id);
  }

  function handleResetWorkspace() {
    captureRequestIdRef.current += 1;
    setProject(null);
    setCaptureError(null);
    setIsCapturing(false);
    setIsRestoring(false);
    setResetVersion((current) => current + 1);
    window.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="workspace-grid">
      <YouTubeIntakeForm
        key={`intake-${project?.id ?? "empty"}-${resetVersion}`}
        project={project}
        onProjectCreated={handleProjectCreated}
        isRestoring={isRestoring}
        isCapturing={isCapturing}
        captureError={captureError}
        onResetWorkspace={handleResetWorkspace}
        onRecapture={() => {
          if (project) {
            void captureFrames(project);
          }
        }}
      />
      <FrameSelectionLab
        key={`lab-${project?.id ?? "empty"}-${resetVersion}`}
        project={project}
        onProjectUpdated={handleProjectUpdated}
        isCapturing={isCapturing}
      />
    </section>
  );
}
