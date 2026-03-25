"use client";

import { useEffect, useRef, useState } from "react";
import { Film, FolderOpen, Pencil, RefreshCw, Trash2 } from "lucide-react";

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
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
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

  async function deleteProject(projectId: string) {
    const targetProject = savedProjects.find((savedProject) => savedProject.id === projectId);

    if (
      !window.confirm(
        `저장된 작업 "${targetProject?.title ?? "이 작업"}"을 삭제할까요?\n캡처 프레임과 생성된 악보도 함께 삭제됩니다.`
      )
    ) {
      return;
    }

    setDeletingProjectId(projectId);
    setSavedProjectsError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "저장된 작업을 삭제하지 못했습니다.");
      }

      if (editingProjectId === projectId) {
        closeRenameEditor();
      }

      setSavedProjects((currentProjects) =>
        currentProjects.filter((savedProject) => savedProject.id !== projectId)
      );

      if (project?.id === projectId) {
        captureRequestIdRef.current += 1;
        setProject(null);
        setCaptureError(null);
        setIsCapturing(false);
        setResetVersion((current) => current + 1);
        setWorkspaceMode("library");
        window.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
      }

      void refreshSavedProjects();
    } catch (error) {
      setSavedProjectsError(error instanceof Error ? error.message : "저장된 작업을 삭제하지 못했습니다.");
    } finally {
      setDeletingProjectId((currentProjectId) => (currentProjectId === projectId ? null : currentProjectId));
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
    ? "복원 중"
    : isCapturing
      ? "캡처 중"
      : project?.assembledScore
        ? "악보 완료"
        : project?.frames?.length
          ? "ROI 점검"
          : "새 작업";
  const statusMetricText = project?.assembledScore
    ? `${project.assembledScore.sourceFrameCount} -> ${project.assembledScore.stitchedFrameCount}`
    : project?.frames?.length
      ? `${project.frames.length} frames`
      : "준비";
  const workspaceDescription = project?.normalizedUrl
    ? project.normalizedUrl
    : "저장된 작업을 열거나 YouTube 링크로 새 작업을 시작하세요.";
  const currentProjectSummary = project?.assembledScore
    ? `악보 ${project.assembledScore.stitchedFrameCount}조각`
    : project?.frames?.length
      ? `캡처 ${project.frames.length}개`
      : "링크 입력 대기";
  const workspaceTabs = [
    {
      id: "library",
      label: "저장된 작업",
      caption: "불러오기 · 정리",
      icon: FolderOpen,
      disabled: false
    },
    {
      id: "convert",
      label: "유튜브 변환",
      caption: "캡처 · ROI",
      icon: Film,
      disabled: false
    },
    {
      id: "edit",
      label: "악보 수정",
      caption: "조각 편집 · 보기",
      icon: Pencil,
      disabled: !project?.assembledScore
    }
  ] satisfies Array<{
    id: WorkspaceMode;
    label: string;
    caption: string;
    icon: typeof FolderOpen;
    disabled: boolean;
  }>;

  return (
    <section className="workspace-grid">
      <section className="minimal-card workspace-shell stack-sm">
        <div className="workspace-header">
          <div className="workspace-brand-block stack-xs">
            <p className="workspace-eyebrow">YouTube Guitar Tab Workspace</p>
            <h1 className="page-title workspace-brand-title">YouTabMaker</h1>
          </div>

          <div className="workspace-status-row">
            <div className="workspace-status-card is-dark">
              <p className="workspace-status-label">상태</p>
              <p className="workspace-status-value">{statusText}</p>
            </div>
            <div className="workspace-status-card">
              <p className="workspace-status-label">요약</p>
              <p className="workspace-status-value">{statusMetricText}</p>
            </div>
          </div>
        </div>

        <div className="workspace-current-card">
          <div className="workspace-current-copy stack-xs">
            <p className="workspace-current-label">현재 작업</p>
            <p className="workspace-current-name">{project?.title ?? "새 작업"}</p>
            <p className="workspace-current-source" title={workspaceDescription}>
              {workspaceDescription}
            </p>
          </div>
          <p className="workspace-current-summary">{currentProjectSummary}</p>
        </div>

        <div className="workspace-tab-shell">
          <div className="workspace-tab-strip" role="tablist" aria-label="작업 화면 탭">
            {workspaceTabs.map((tab) => {
              const Icon = tab.icon;

              return (
                <button
                  key={tab.id}
                  className={workspaceMode === tab.id ? "workspace-tab is-active" : "workspace-tab"}
                  type="button"
                  role="tab"
                  id={`workspace-tab-${tab.id}`}
                  aria-selected={workspaceMode === tab.id}
                  aria-controls={`workspace-panel-${tab.id}`}
                  disabled={tab.disabled}
                  onClick={() => setWorkspaceMode(tab.id)}
                >
                  <span className="workspace-tab-head">
                    <span className="button-with-icon">
                      <Icon className="button-icon" aria-hidden="true" />
                      <span className="button-label">{tab.label}</span>
                    </span>
                  </span>
                  <span className="workspace-tab-caption">{tab.caption}</span>
                </button>
              );
            })}
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
                const isDeletingProject = deletingProjectId === savedProject.id;

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
                        <div className="saved-project-secondary-actions">
                          <button
                            className="ghost-button icon-button"
                            type="button"
                            onClick={() => openRenameEditor(savedProject)}
                            disabled={isLoadingProject || isDeletingProject}
                            title="작업 이름 수정"
                            aria-label="작업 이름 수정"
                          >
                            <Pencil className="button-icon" aria-hidden="true" />
                          </button>
                          <button
                            className="ghost-button icon-button"
                            type="button"
                            onClick={() => void deleteProject(savedProject.id)}
                            disabled={isLoadingProject || isDeletingProject}
                            title="저장된 작업 삭제"
                            aria-label="저장된 작업 삭제"
                          >
                            <Trash2 className="button-icon" aria-hidden="true" />
                          </button>
                        </div>
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => void loadProjectById(savedProject.id)}
                          disabled={isLoadingProject || isDeletingProject}
                        >
                          <span className="button-with-icon">
                            <FolderOpen className="button-icon" aria-hidden="true" />
                            <span className="button-label">
                              {isDeletingProject ? "삭제 중" : isLoadingProject ? "불러오는 중" : "불러오기"}
                            </span>
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
