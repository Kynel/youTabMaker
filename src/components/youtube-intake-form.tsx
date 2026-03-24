"use client";

import { FormEvent, useEffect, useState } from "react";

import type { DraftProject } from "@/lib/types";

interface IntakeResponse {
  project: DraftProject;
}

interface YouTubeIntakeFormProps {
  project: DraftProject | null;
  onProjectCreated: (project: DraftProject) => void;
  onResetWorkspace: () => void;
  isRestoring?: boolean;
  isCapturing: boolean;
  captureError: string | null;
  onRecapture: () => void;
  showHeader?: boolean;
}

export function YouTubeIntakeForm({
  project,
  onProjectCreated,
  onResetWorkspace,
  isRestoring = false,
  isCapturing,
  captureError,
  onRecapture,
  showHeader = true
}: YouTubeIntakeFormProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (project?.normalizedUrl) {
      setUrl(project.normalizedUrl);
      return;
    }

    setUrl("");
  }, [project?.normalizedUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url })
      });

      const payload = (await response.json().catch(() => null)) as IntakeResponse & {
        error?: string;
      } | null;

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error ?? "Unable to create a draft project.");
      }

      onProjectCreated(payload.project);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Unexpected error while creating a draft project."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

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
    <section className="minimal-card stack-sm">
      {showHeader ? (
        <div className="page-header">
          <h1 className="page-title">YouTabMaker</h1>
          <p className="status-line">{statusText}</p>
        </div>
      ) : (
        <div className="row-between">
          <p className="section-label">YouTube URL</p>
          <p className="status-line">{statusText}</p>
        </div>
      )}

      <form className="inline-form" onSubmit={handleSubmit}>
        <label className="grow" htmlFor="youtube-url">
          <span className="field-label">YouTube URL</span>
          <input
            id="youtube-url"
            className="text-input"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            required
          />
        </label>

        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "연결 중" : "불러오기"}
        </button>
        <button className="ghost-button" type="button" onClick={onRecapture} disabled={!project || isCapturing}>
          다시 추출
        </button>
        <button className="ghost-button" type="button" onClick={onResetWorkspace}>
          초기화
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}
      {captureError ? <p className="error-text">{captureError}</p> : null}
    </section>
  );
}
