"use client";

import { useEffect, useRef, useState } from "react";
import { Film, FolderOpen, Pencil, RefreshCw } from "lucide-react";

import { FrameSelectionLab } from "@/components/frame-selection-lab";
import { YouTubeIntakeForm } from "@/components/youtube-intake-form";
import type { DraftProject, SavedProjectSummary } from "@/lib/types";

const LAST_PROJECT_STORAGE_KEY = "youtabmaker:last-project-id";
type WorkspaceMode = "library" | "convert" | "edit";

function formatSavedProjectDate(timestamp: string) {
  const parsedDate = new Date(timestamp);

  if (Number.isNaN(parsedDate.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsedDate);
}

function buildSavedProjectSummary(project: DraftProject): SavedProjectSummary {
  return {
    id: project.id,
    title: project.title,
    sourceUrl: project.sourceUrl,
    normalizedUrl: project.normalizedUrl,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    frameCount: project.frames?.length ?? 0,
    stitchedFrameCount: project.assembledScore?.stitchedFrameCount ?? 0,
    hasAssembledScore: Boolean(project.assembledScore)
  };
}

function buildSavedProjectStatusLabel(project: SavedProjectSummary) {
  if (project.hasAssembledScore) {
    return `완성 ${project.stitchedFrameCount}`;
  }

  if (project.frameCount > 0) {
    return `프레임 ${project.frameCount}`;
  }

  return "준비 중";
}

export function TabWorkbench() {
  const [project, setProject] = useState<DraftProject | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [savedProjects, setSavedProjects] = useState<SavedProjectSummary[]>([]);
  const [savedProjectsError, setSavedProjectsError] = useState<string | null>(null);
  const [isLoadingSavedProjects, setIsLoadingSavedProjects] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [savingProjectTitleId, setSavingProjectTitleId] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("convert");
  const captureRequestIdRef = useRef(0);

  async function refreshSavedProjects() {
    setIsLoadingSavedProjects(true);
    setSavedProjectsError(null);

    try {
      const response = await fetch("/api/projects", {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as
        | { projects?: SavedProjectSummary[]; error?: string }
        | null;

      if (!response.ok || !payload?.projects) {
        throw new Error(payload?.error ?? "저장된 작업 목록을 불러오지 못했습니다.");
      }

      setSavedProjects(payload.projects);
    } catch (error) {
      setSavedProjectsError(
        error instanceof Error ? error.message : "저장된 작업 목록을 불러오지 못했습니다."
      );
    } finally {
      setIsLoadingSavedProjects(false);
    }
  }

  function syncSavedProject(projectToSync: DraftProject) {
    const nextSummary = buildSavedProjectSummary(projectToSync);

    setSavedProjects((currentProjects) =>
      [nextSummary, ...currentProjects.filter((projectItem) => projectItem.id !== nextSummary.id)].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      )
    );
  }

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
        throw new Error(payload?.error ?? "유튜브 영상에서 프레임을 추출하지 못했습니다.");
      }

      if (captureRequestIdRef.current !== requestId) {
        return;
      }

      setProject(payload.project);
      syncSavedProject(payload.project);
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, payload.project.id);
      void refreshSavedProjects();
    } catch (error) {
      if (captureRequestIdRef.current !== requestId) {
        return;
      }

      setCaptureError(error instanceof Error ? error.message : "유튜브 영상에서 프레임을 추출하지 못했습니다.");
    } finally {
      if (captureRequestIdRef.current === requestId) {
        setIsCapturing(false);
      }
    }
  }

  async function loadProjectById(projectId: string) {
    captureRequestIdRef.current += 1;
    setIsCapturing(false);
    setCaptureError(null);
    setSavedProjectsError(null);
    setLoadingProjectId(projectId);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as
        | { project?: DraftProject; error?: string }
        | null;

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error ?? "저장된 작업을 불러오지 못했습니다.");
      }

      setProject(payload.project);
      syncSavedProject(payload.project);
      setWorkspaceMode(payload.project.assembledScore ? "edit" : "convert");
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, payload.project.id);

      if (!payload.project.frames || payload.project.frames.length === 0) {
        await captureFrames(payload.project);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "저장된 작업을 불러오지 못했습니다.";
      setCaptureError(message);
      setSavedProjectsError(message);
    } finally {
      setLoadingProjectId((currentProjectId) => (currentProjectId === projectId ? null : currentProjectId));
    }
  }

  async function renameProject(projectId: string) {
    const nextTitle = projectTitleDraft.trim();

    if (!nextTitle) {
      setSavedProjectsError("작업 이름을 입력해 주세요.");
      return;
    }

    setSavingProjectTitleId(projectId);
    setSavedProjectsError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: nextTitle
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { project?: DraftProject; error?: string }
        | null;

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error ?? "작업 이름을 저장하지 못했습니다.");
      }

      syncSavedProject(payload.project);

      if (project?.id === payload.project.id) {
        setProject(payload.project);
      }

      closeRenameEditor();
      void refreshSavedProjects();
    } catch (error) {
      setSavedProjectsError(error instanceof Error ? error.message : "작업 이름을 저장하지 못했습니다.");
    } finally {
      setSavingProjectTitleId((currentProjectId) => (currentProjectId === projectId ? null : currentProjectId));
    }
  }

  function openRenameEditor(savedProject: SavedProjectSummary) {
    setEditingProjectId(savedProject.id);
    setProjectTitleDraft(savedProject.title);
    setSavedProjectsError(null);
  }

  function closeRenameEditor() {
    setEditingProjectId(null);
    setProjectTitleDraft("");
  }

  useEffect(() => {
    async function restoreProject() {
      const lastProjectId = window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);

      if (!lastProjectId) {
        setIsRestoring(false);
        return;
      }

      try {
        await loadProjectById(lastProjectId);
      } finally {
        setIsRestoring(false);
      }
    }

    void refreshSavedProjects();
    void restoreProject();
  }, []);

  function handleProjectCreated(nextProject: DraftProject) {
    setProject(nextProject);
    syncSavedProject(nextProject);
    setWorkspaceMode("convert");
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, nextProject.id);
    void refreshSavedProjects();
    void captureFrames(nextProject);
  }

  function handleProjectUpdated(nextProject: DraftProject) {
    setProject(nextProject);
    syncSavedProject(nextProject);
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, nextProject.id);
  }

  function handleResetWorkspace() {
    captureRequestIdRef.current += 1;
    closeRenameEditor();
    setProject(null);
    setCaptureError(null);
    setSavedProjectsError(null);
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
      : project?.assembledScore
        ? `완성 ${project.assembledScore.stitchedFrameCount}`
        : project?.frames?.length
          ? `프레임 ${project.frames.length}`
          : "대기";
  const statusMetricText = project?.assembledScore
    ? `${project.assembledScore.sourceFrameCount} -> ${project.assembledScore.stitchedFrameCount}`
    : project?.frames?.length
      ? `${project.frames.length} frames`
      : "준비";

  return (
    <section className="workspace-grid">
      <section className="minimal-card stack-sm">
        <div className="page-header workspace-header">
          <div className="workspace-title-block">
            <h1 className="page-title">YouTabMaker</h1>
            <div className="workspace-project-line">
              <span className="workspace-project-prefix">PROJECT</span>
              <p className="workspace-current-name">{project?.title ?? "새 작업"}</p>
            </div>
          </div>
          <div className="workspace-status-row">
            <p className="status-pill">{statusText}</p>
            <p className="workspace-metric-chip">{statusMetricText}</p>
          </div>
        </div>

        <div className="workspace-tab-shell">
          <div className="workspace-tab-strip" role="tablist" aria-label="작업 화면 탭">
            <button
              className={workspaceMode === "library" ? "workspace-tab is-active" : "workspace-tab"}
              type="button"
              role="tab"
              id="workspace-tab-library"
              aria-selected={workspaceMode === "library"}
              aria-controls="workspace-panel-library"
              onClick={() => setWorkspaceMode("library")}
            >
              <span className="button-with-icon">
                <FolderOpen className="button-icon" aria-hidden="true" />
                <span className="button-label">저장된 작업</span>
              </span>
            </button>
            <button
              className={workspaceMode === "convert" ? "workspace-tab is-active" : "workspace-tab"}
              type="button"
              role="tab"
              id="workspace-tab-convert"
              aria-selected={workspaceMode === "convert"}
              aria-controls="workspace-panel-convert"
              onClick={() => setWorkspaceMode("convert")}
            >
              <span className="button-with-icon">
                <Film className="button-icon" aria-hidden="true" />
                <span className="button-label">유튜브 변환</span>
              </span>
            </button>
            <button
              className={workspaceMode === "edit" ? "workspace-tab is-active" : "workspace-tab"}
              type="button"
              role="tab"
              id="workspace-tab-edit"
              aria-selected={workspaceMode === "edit"}
              aria-controls="workspace-panel-edit"
              disabled={!project?.assembledScore}
              onClick={() => setWorkspaceMode("edit")}
            >
              <span className="button-with-icon">
                <Pencil className="button-icon" aria-hidden="true" />
                <span className="button-label">악보 수정</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      {workspaceMode === "library" ? (
        <section
          className="minimal-card stack-sm"
          id="workspace-panel-library"
          role="tabpanel"
          aria-labelledby="workspace-tab-library"
        >
          <div className="row-between library-toolbar">
            <div className="stack-xs library-title-block">
              <h2 className="section-title">저장된 작업</h2>
              <p className="muted">로컬에 자동 저장된 작업을 불러오거나 이름을 바꿀 수 있습니다.</p>
            </div>
            <div className="action-row library-actions">
              <button className="ghost-button" type="button" onClick={() => void refreshSavedProjects()}>
                <span className="button-with-icon">
                  <RefreshCw className="button-icon" aria-hidden="true" />
                  <span className="button-label">목록 새로고침</span>
                </span>
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  closeRenameEditor();
                  setWorkspaceMode("convert");
                }}
              >
                <span className="button-with-icon">
                  <Film className="button-icon" aria-hidden="true" />
                  <span className="button-label">새 작업</span>
                </span>
              </button>
            </div>
          </div>

          {savedProjectsError ? <p className="error-text">{savedProjectsError}</p> : null}

          {savedProjects.length > 0 ? (
            <div className="saved-project-list">
              {savedProjects.map((savedProject) => {
                const isCurrentProject = savedProject.id === project?.id;
                const isLoadingProject = loadingProjectId === savedProject.id;
                const isEditingTitle = editingProjectId === savedProject.id;
                const isSavingTitle = savingProjectTitleId === savedProject.id;

                return (
                  <article
                    className={isCurrentProject ? "saved-project-card is-active" : "saved-project-card"}
                    key={savedProject.id}
                  >
                    <div className="saved-project-main stack-xs">
                      {isEditingTitle ? (
                        <form
                          className="saved-project-rename-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void renameProject(savedProject.id);
                          }}
                        >
                          <label className="grow" htmlFor={`project-title-${savedProject.id}`}>
                            <span className="field-label">작업 이름</span>
                            <input
                              id={`project-title-${savedProject.id}`}
                              className="text-input"
                              type="text"
                              value={projectTitleDraft}
                              onChange={(event) => setProjectTitleDraft(event.target.value)}
                              maxLength={80}
                              autoFocus
                            />
                          </label>
                          <button className="primary-button" type="submit" disabled={isSavingTitle}>
                            {isSavingTitle ? "저장 중" : "저장"}
                          </button>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={closeRenameEditor}
                            disabled={isSavingTitle}
                          >
                            취소
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="saved-project-heading">
                            <div className="saved-project-title-row">
                              <p className="saved-project-title">{savedProject.title}</p>
                              {isCurrentProject ? <span className="saved-project-badge">현재 작업</span> : null}
                            </div>
                            <p className="muted">{formatSavedProjectDate(savedProject.updatedAt)}</p>
                          </div>
                          <p className="saved-project-url">{savedProject.normalizedUrl}</p>
                          <div className="saved-project-meta">
                            <p className="saved-project-stat">상태 {buildSavedProjectStatusLabel(savedProject)}</p>
                            <p className="saved-project-stat">프레임 {savedProject.frameCount}</p>
                          </div>
                        </>
                      )}
                    </div>

                    {!isEditingTitle ? (
                      <div className="saved-project-actions">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => openRenameEditor(savedProject)}
                        >
                          <span className="button-with-icon">
                            <Pencil className="button-icon" aria-hidden="true" />
                            <span className="button-label">이름 수정</span>
                          </span>
                        </button>
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => void loadProjectById(savedProject.id)}
                          disabled={isLoadingProject}
                        >
                          <span className="button-with-icon">
                            <FolderOpen className="button-icon" aria-hidden="true" />
                            <span className="button-label">{isLoadingProject ? "불러오는 중" : "불러오기"}</span>
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-box">
              {isLoadingSavedProjects ? "저장된 작업 목록을 불러오는 중입니다." : "아직 저장된 작업이 없습니다."}
            </div>
          )}
        </section>
      ) : null}

      {workspaceMode === "convert" ? (
        <section
          className="workspace-panel-shell stack-sm"
          id="workspace-panel-convert"
          role="tabpanel"
          aria-labelledby="workspace-tab-convert"
        >
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
          <FrameSelectionLab
            key={`lab-convert-${project?.id ?? "empty"}-${resetVersion}`}
            project={project}
            onProjectUpdated={handleProjectUpdated}
            isCapturing={isCapturing}
            workspaceMode="convert"
            onRequestWorkspaceMode={(nextWorkspaceMode) => setWorkspaceMode(nextWorkspaceMode)}
          />
        </section>
      ) : null}

      {workspaceMode === "edit" ? (
        <section
          className="workspace-panel-shell"
          id="workspace-panel-edit"
          role="tabpanel"
          aria-labelledby="workspace-tab-edit"
        >
          <FrameSelectionLab
            key={`lab-edit-${project?.id ?? "empty"}-${resetVersion}`}
            project={project}
            onProjectUpdated={handleProjectUpdated}
            isCapturing={isCapturing}
            workspaceMode="edit"
            onRequestWorkspaceMode={(nextWorkspaceMode) => setWorkspaceMode(nextWorkspaceMode)}
          />
        </section>
      ) : null}
    </section>
  );
}
