"use client";

import { useEffect, useRef, useState } from "react";

import { FrameSelectionLab } from "@/components/frame-selection-lab";
import { YouTubeIntakeForm } from "@/components/youtube-intake-form";
import type { DraftProject } from "@/lib/types";

const LAST_PROJECT_STORAGE_KEY = "youtabmaker:last-project-id";
type WorkspaceMode = "convert" | "edit";

export function TabWorkbench() {
  const [project, setProject] = useState<DraftProject | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("convert");
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

  useEffect(() => {
    if (workspaceMode === "edit" && !project?.assembledScore) {
      setWorkspaceMode("convert");
    }
  }, [project?.assembledScore, workspaceMode]);

  const statusText = isRestoring
    ? "이전 작업 불러오는 중"
    : isCapturing
      ? "프레임 추출 중"
      : project?.assemblyReview?.pendingCount
        ? `검수 ${project.assemblyReview.pendingCount}`
      : project?.assembledScore
        ? `완성 ${project.assembledScore.stitchedFrameCount}`
        : project?.frames?.length
          ? `프레임 ${project.frames.length}`
          : "대기";

  return (
    <section className="workspace-grid">
      <section className="minimal-card stack-sm">
        <div className="page-header">
          <h1 className="page-title">YouTabMaker</h1>
          <p className="status-line">{statusText}</p>
        </div>
        <div className="workspace-tabs" role="tablist" aria-label="Workbench mode">
          <button
            className={workspaceMode === "convert" ? "workspace-tab is-active" : "workspace-tab"}
            type="button"
            role="tab"
            aria-selected={workspaceMode === "convert"}
            onClick={() => setWorkspaceMode("convert")}
          >
            유튜브 변환
          </button>
          <button
            className={workspaceMode === "edit" ? "workspace-tab is-active" : "workspace-tab"}
            type="button"
            role="tab"
            aria-selected={workspaceMode === "edit"}
            disabled={!project?.assembledScore}
            onClick={() => setWorkspaceMode("edit")}
          >
            악보 수정
          </button>
        </div>
      </section>

      {workspaceMode === "convert" ? (
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
          showHeader={false}
        />
      ) : null}
      <FrameSelectionLab
        key={`lab-${project?.id ?? "empty"}-${resetVersion}`}
        project={project}
        onProjectUpdated={handleProjectUpdated}
        isCapturing={isCapturing}
        workspaceMode={workspaceMode}
        onRequestWorkspaceMode={(nextWorkspaceMode) => setWorkspaceMode(nextWorkspaceMode)}
      />
    </section>
  );
}
