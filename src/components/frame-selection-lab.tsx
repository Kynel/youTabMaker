"use client";

import { useEffect, useRef, useState } from "react";

import type { DraftProject, ProjectFrameAsset, ProjectProcessingStatus, RoiSelection } from "@/lib/types";

interface DragState {
  startX: number;
  startY: number;
}

interface RawSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PreviewBackground = "dark" | "light";
type ScoreColorMode = "original" | "inverted";

interface FrameSelectionLabProps {
  project: DraftProject | null;
  onProjectUpdated: (project: DraftProject) => void;
  isCapturing: boolean;
}

function normalizeRect(selection: RawSelection): RawSelection {
  const x = selection.width < 0 ? selection.x + selection.width : selection.x;
  const y = selection.height < 0 ? selection.y + selection.height : selection.y;
  const width = Math.abs(selection.width);
  const height = Math.abs(selection.height);

  return { x, y, width, height };
}

function projectAssetUrl(projectId: string, relativePath: string) {
  return `/api/projects/${projectId}/assets/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function buildBottomBandSelection(width: number, height: number): RawSelection {
  return {
    x: width * 0.04,
    y: height * 0.58,
    width: width * 0.92,
    height: height * 0.35
  };
}

function formatSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clampProgress(progressPercent: number | undefined) {
  if (typeof progressPercent !== "number" || !Number.isFinite(progressPercent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(progressPercent)));
}

export function FrameSelectionLab({
  project,
  onProjectUpdated,
  isCapturing
}: FrameSelectionLabProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [selection, setSelection] = useState<RawSelection | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<"manual" | "bottom-band-suggestion">("manual");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isAssembling, setIsAssembling] = useState(false);
  const [isScoreViewerOpen, setIsScoreViewerOpen] = useState(false);
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>("dark");
  const [scoreColorMode, setScoreColorMode] = useState<ScoreColorMode>("original");
  const [isDownloadingScore, setIsDownloadingScore] = useState(false);

  const frames = project?.frames ?? [];
  const projectId = project?.id ?? null;
  const assembledScoreUrl =
    project?.assembledScore && project
      ? projectAssetUrl(project.id, project.assembledScore.relativePath)
      : null;

  const selectedFrame =
    project && selectedFrameId ? frames.find((frame) => frame.id === selectedFrameId) ?? null : null;
  const shouldPollProcessing = Boolean(project && (isCapturing || isAssembling || project.processing));
  const processingState: ProjectProcessingStatus | {
    kind: "capture" | "assemble";
    stage: string;
    label: string;
    detail: string;
    progressPercent: number;
    current?: number;
    total?: number;
    unit?: string;
  } | null =
    project?.processing ??
    (isCapturing
      ? {
          kind: "capture",
          stage: "preparing",
          label: "영상 캡처 처리 중",
          detail: "작업 상태를 불러오고 있습니다.",
          progressPercent: 4
        }
      : isAssembling
        ? {
            kind: "assemble",
            stage: "preparing",
            label: "악보 생성 처리 중",
            detail: "작업 상태를 불러오고 있습니다.",
            progressPercent: 4
          }
        : null);

  useEffect(() => {
    if (frames.length === 0) {
      setSelectedFrameId(null);
      setImageElement(null);
      return;
    }

    setSelectedFrameId((currentSelectedFrameId) => {
      if (currentSelectedFrameId && frames.some((frame) => frame.id === currentSelectedFrameId)) {
        return currentSelectedFrameId;
      }

      return frames[0]?.id ?? null;
    });
  }, [frames]);

  useEffect(() => {
    if (!project || !selectedFrame) {
      return;
    }

    const nextImage = new Image();
    nextImage.onload = () => {
      setImageElement(nextImage);
      setStatusMessage(null);

      if (project.roi?.selection) {
        setSelection({
          x: project.roi.selection.x,
          y: project.roi.selection.y,
          width: project.roi.selection.width,
          height: project.roi.selection.height
        });
        setSelectionMode(project.roi.selectionMode);
        return;
      }

      setSelection(buildBottomBandSelection(nextImage.naturalWidth, nextImage.naturalHeight));
      setSelectionMode("bottom-band-suggestion");
    };
    nextImage.src = projectAssetUrl(project.id, selectedFrame.relativePath);
  }, [project, selectedFrame]);

  useEffect(() => {
    if (!isScoreViewerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsScoreViewerOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isScoreViewerOpen]);

  useEffect(() => {
    if (!assembledScoreUrl) {
      setIsScoreViewerOpen(false);
    }
  }, [assembledScoreUrl]);

  useEffect(() => {
    if (!assembledScoreUrl) {
      setScoreColorMode("original");
    }
  }, [assembledScoreUrl]);

  useEffect(() => {
    if (!projectId || !shouldPollProcessing) {
      return;
    }

    let isActive = true;

    async function pollProject() {
      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => null)) as { project?: DraftProject } | null;

        if (isActive && response.ok && payload?.project) {
          onProjectUpdated(payload.project);
        }
      } catch {
        // Ignore transient polling failures while a long-running task is active.
      }
    }

    void pollProject();
    const intervalId = window.setInterval(() => {
      void pollProject();
    }, 700);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [onProjectUpdated, projectId, shouldPollProcessing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const maxWidth = 920;
    const imageWidth = imageElement?.naturalWidth ?? maxWidth;
    const imageHeight = imageElement?.naturalHeight ?? 520;
    const drawWidth = Math.min(maxWidth, imageWidth);
    const scale = drawWidth / imageWidth;
    const drawHeight = imageElement ? imageHeight * scale : 520;

    canvas.width = Math.floor(drawWidth * dpr);
    canvas.height = Math.floor(drawHeight * dpr);
    canvas.style.width = `${drawWidth}px`;
    canvas.style.height = `${drawHeight}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, drawWidth, drawHeight);

    if (!imageElement) {
      context.fillStyle = "#121a1f";
      context.fillRect(0, 0, drawWidth, drawHeight);
      context.fillStyle = "#f7efe4";
      context.font = '600 22px "Avenir Next", "Trebuchet MS", sans-serif';
      context.fillText("URL을 넣으면 영상 프레임이 자동으로 여기에 표시됩니다.", 28, 68);
      context.font = '400 16px "Avenir Next", "Trebuchet MS", sans-serif';
      context.fillStyle = "rgba(247, 239, 228, 0.72)";
      context.fillText("원하는 프레임에서 tab 영역만 잡으면 전체 악보를 자동 생성합니다.", 28, 102);
      return;
    }

    context.drawImage(imageElement, 0, 0, drawWidth, drawHeight);

    if (selection) {
      const normalized = normalizeRect(selection);
      const scaledX = normalized.x * scale;
      const scaledY = normalized.y * scale;
      const scaledWidth = normalized.width * scale;
      const scaledHeight = normalized.height * scale;

      context.save();
      context.fillStyle = "rgba(0, 0, 0, 0.52)";
      context.fillRect(0, 0, drawWidth, scaledY);
      context.fillRect(0, scaledY, scaledX, scaledHeight);
      context.fillRect(
        scaledX + scaledWidth,
        scaledY,
        Math.max(0, drawWidth - (scaledX + scaledWidth)),
        scaledHeight
      );
      context.fillRect(
        0,
        scaledY + scaledHeight,
        drawWidth,
        Math.max(0, drawHeight - (scaledY + scaledHeight))
      );

      context.fillStyle = "rgba(0, 0, 0, 0.14)";
      context.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);

      context.strokeStyle = "rgba(0, 0, 0, 0.92)";
      context.lineWidth = 4;
      context.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);

      if (scaledWidth > 6 && scaledHeight > 6) {
        context.strokeStyle = "rgba(255, 255, 255, 0.72)";
        context.lineWidth = 1;
        context.strokeRect(scaledX + 2, scaledY + 2, scaledWidth - 4, scaledHeight - 4);
      }

      const label = "TAB ROI";
      context.font = '600 12px "IBM Plex Mono", "SFMono-Regular", monospace';
      const labelWidth = Math.ceil(context.measureText(label).width) + 14;
      const labelHeight = 22;
      const labelX = Math.min(Math.max(8, scaledX + 8), Math.max(8, drawWidth - labelWidth - 8));
      const labelY =
        scaledY > labelHeight + 12 ? scaledY - labelHeight - 8 : Math.max(8, scaledY + 8);

      context.fillStyle = "rgba(0, 0, 0, 0.86)";
      context.fillRect(labelX, labelY, labelWidth, labelHeight);
      context.strokeStyle = "rgba(255, 255, 255, 0.52)";
      context.lineWidth = 1;
      context.strokeRect(labelX, labelY, labelWidth, labelHeight);
      context.fillStyle = "#f2f2f2";
      context.fillText(label, labelX + 7, labelY + 14);
      context.restore();
    }
  }, [imageElement, selection]);

  useEffect(() => {
    const previewCanvas = previewCanvasRef.current;
    const previewContext = previewCanvas?.getContext("2d");

    if (!previewCanvas || !previewContext) {
      return;
    }

    if (!imageElement || !selection) {
      previewCanvas.width = 1;
      previewCanvas.height = 1;
      previewContext.clearRect(0, 0, 1, 1);
      return;
    }

    const normalized = normalizeRect(selection);

    if (normalized.width < 1 || normalized.height < 1) {
      previewCanvas.width = 1;
      previewCanvas.height = 1;
      previewContext.clearRect(0, 0, 1, 1);
      return;
    }

    previewCanvas.width = Math.max(1, Math.floor(normalized.width));
    previewCanvas.height = Math.max(1, Math.floor(normalized.height));
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(
      imageElement,
      normalized.x,
      normalized.y,
      normalized.width,
      normalized.height,
      0,
      0,
      previewCanvas.width,
      previewCanvas.height
    );
  }, [imageElement, selection]);

  function getCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canvasRef.current || !imageElement) {
      return null;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = imageElement.naturalWidth / rect.width;
    const scaleY = imageElement.naturalHeight / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = getCanvasPoint(event);

    if (!point) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectionMode("manual");
    setDragState({
      startX: point.x,
      startY: point.y
    });
    setSelection({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0
    });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragState) {
      return;
    }

    const point = getCanvasPoint(event);

    if (!point) {
      return;
    }

    setSelection({
      x: dragState.startX,
      y: dragState.startY,
      width: point.x - dragState.startX,
      height: point.y - dragState.startY
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragState) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragState(null);
  }

  function suggestBottomBand() {
    if (!imageElement) {
      return;
    }

    setSelection(buildBottomBandSelection(imageElement.naturalWidth, imageElement.naturalHeight));
    setSelectionMode("bottom-band-suggestion");
  }

  function clearSelection() {
    setSelection(null);
    setSelectionMode("manual");
  }

  function buildRoiSelection(): RoiSelection | null {
    if (!imageElement || !selection) {
      return null;
    }

    const normalized = normalizeRect(selection);

    return {
      x: Math.round(normalized.x),
      y: Math.round(normalized.y),
      width: Math.round(normalized.width),
      height: Math.round(normalized.height),
      normalized: {
        x: Number((normalized.x / imageElement.naturalWidth).toFixed(4)),
        y: Number((normalized.y / imageElement.naturalHeight).toFixed(4)),
        width: Number((normalized.width / imageElement.naturalWidth).toFixed(4)),
        height: Number((normalized.height / imageElement.naturalHeight).toFixed(4))
      }
    };
  }

  const roi = buildRoiSelection();

  async function generateFullScore() {
    if (!project || !roi) {
      return;
    }

    setIsAssembling(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/assemble`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          roi,
          selectionMode
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { project?: DraftProject; error?: string }
        | null;

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error ?? "Failed to assemble the full tab score.");
      }

      onProjectUpdated(payload.project);
      setStatusMessage("영상 전체 tab를 하나의 악보로 완성했습니다.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to assemble the full tab score."
      );
    } finally {
      setIsAssembling(false);
    }
  }

  async function downloadScoreImage() {
    if (!assembledScoreUrl || isDownloadingScore) {
      return;
    }

    setIsDownloadingScore(true);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("Failed to load the assembled tab image."));
        nextImage.src = assembledScoreUrl;
      });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas is not available for PNG export.");
      }

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.drawImage(image, 0, 0);

      if (scoreColorMode === "inverted") {
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const { data } = imageData;

        for (let index = 0; index < data.length; index += 4) {
          data[index] = 255 - data[index];
          data[index + 1] = 255 - data[index + 1];
          data[index + 2] = 255 - data[index + 2];
        }

        context.putImageData(imageData, 0, 0);
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) {
            resolve(nextBlob);
            return;
          }

          reject(new Error("Failed to encode the PNG file."));
        }, "image/png");
      });

      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download =
        scoreColorMode === "inverted"
          ? "assembled-tab-inverted.png"
          : "assembled-tab-original.png";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 0);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to export the assembled tab image."
      );
    } finally {
      setIsDownloadingScore(false);
    }
  }

  const assembledImageClassName =
    scoreColorMode === "inverted" ? "assembled-image is-inverted" : "assembled-image";
  const viewerImageClassName = scoreColorMode === "inverted" ? "viewer-image is-inverted" : "viewer-image";

  if (!project) {
    return (
      <section className="minimal-card">
        <div className="empty-box">URL을 넣고 영상을 불러오면 여기서 ROI를 선택할 수 있습니다.</div>
      </section>
    );
  }

  const summaryText = project.assembledScore
    ? `${project.assembledScore.sourceFrameCount} -> ${project.assembledScore.stitchedFrameCount}`
    : frames.length > 0
      ? `${frames.length} frames`
      : isCapturing
        ? "capturing"
        : "ready";

  return (
    <section className="minimal-card stack-sm">
      <div className="row-between">
        <h2 className="section-title">작업</h2>
        <p className="status-line">{summaryText}</p>
      </div>

      <div className="section-block stack-xs">
        <div className="row-between">
          <p className="section-label">Captured Frames</p>
          <p className="muted">{isCapturing ? "추출 중" : selectedFrame ? formatSeconds(selectedFrame.timestampSec) : ""}</p>
        </div>

        <div className="thumbnail-strip">
          {frames.length === 0 ? (
            <p className="preview-empty">프레임 없음</p>
          ) : (
            frames.map((frame) => (
              <FrameThumbnail
                key={frame.id}
                frame={frame}
                isSelected={frame.id === selectedFrameId}
                imageUrl={project ? projectAssetUrl(project.id, frame.relativePath) : ""}
                onSelect={() => setSelectedFrameId(frame.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="section-block stack-xs">
        <div className="action-row">
          <button className="ghost-button" type="button" onClick={suggestBottomBand} disabled={!imageElement}>
            자동 선택
          </button>
          <button className="ghost-button" type="button" onClick={clearSelection} disabled={!selection}>
            ROI 지우기
          </button>
          <button className="primary-button" type="button" onClick={() => void generateFullScore()} disabled={!roi || isAssembling}>
            {isAssembling ? "생성 중" : "전체 Tab 생성"}
          </button>
        </div>

        <div className="canvas-shell">
          <canvas
            ref={canvasRef}
            className="workbench-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        </div>
      </div>

      {statusMessage ? <div className="status-box">{statusMessage}</div> : null}

      <div className="editor-grid">
        <div className="section-block stack-xs">
          <div className="row-between">
            <p className="section-label">ROI Preview</p>
            <div className="toggle-group" role="group" aria-label="ROI preview background">
              <button
                className={previewBackground === "dark" ? "toggle-button is-active" : "toggle-button"}
                type="button"
                onClick={() => setPreviewBackground("dark")}
              >
                검정 배경
              </button>
              <button
                className={previewBackground === "light" ? "toggle-button is-active" : "toggle-button"}
                type="button"
                onClick={() => setPreviewBackground("light")}
              >
                흰 배경
              </button>
            </div>
          </div>
          <div className={previewBackground === "dark" ? "preview-shell is-dark" : "preview-shell is-light"}>
            {roi ? null : <p className="preview-empty">ROI 없음</p>}
            <canvas ref={previewCanvasRef} className={roi ? "preview-canvas" : "preview-canvas is-hidden"} />
          </div>
        </div>

        <div className="section-block stack-xs">
          <div className="row-between">
            <p className="section-label">Final Tab</p>
            <div className="action-row">
              <div className="toggle-group" role="group" aria-label="Final tab color mode">
                <button
                  className={scoreColorMode === "original" ? "toggle-button is-active" : "toggle-button"}
                  type="button"
                  onClick={() => setScoreColorMode("original")}
                >
                  원본
                </button>
                <button
                  className={scoreColorMode === "inverted" ? "toggle-button is-active" : "toggle-button"}
                  type="button"
                  onClick={() => setScoreColorMode("inverted")}
                >
                  반전
                </button>
              </div>
              {project.assembledScore ? (
                <p className="muted">
                  {project.assembledScore.sourceFrameCount}
                  {" -> "}
                  {project.assembledScore.stitchedFrameCount}
                </p>
              ) : null}
            </div>
          </div>
          {project?.assembledScore && assembledScoreUrl ? (
            <>
              <div className={previewBackground === "dark" ? "score-shell is-dark" : "score-shell is-light"}>
                <img className={assembledImageClassName} src={assembledScoreUrl} alt="Assembled guitar tab score" />
              </div>
              <div className="action-row">
                <button className="ghost-button" type="button" onClick={() => setIsScoreViewerOpen(true)}>
                  크게 보기
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void downloadScoreImage()}
                  disabled={isDownloadingScore}
                >
                  {isDownloadingScore ? "PNG 생성 중" : "PNG"}
                </button>
              </div>
            </>
          ) : (
            <div className={previewBackground === "dark" ? "score-shell is-dark" : "score-shell is-light"}>
              <p className="preview-empty">결과 없음</p>
            </div>
          )}
        </div>
      </div>

      {isScoreViewerOpen && assembledScoreUrl ? (
        <div
          className="viewer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Full assembled tab score"
          onClick={() => setIsScoreViewerOpen(false)}
        >
          <div className="viewer-panel" onClick={(event) => event.stopPropagation()}>
            <div className="viewer-toolbar">
              <p className="section-label">Fullscreen Tab</p>
              <div className="action-row">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void downloadScoreImage()}
                  disabled={isDownloadingScore}
                >
                  {isDownloadingScore ? "PNG 생성 중" : "PNG"}
                </button>
                <button className="ghost-button" type="button" onClick={() => setIsScoreViewerOpen(false)}>
                  닫기
                </button>
              </div>
            </div>
            <div className={previewBackground === "dark" ? "viewer-body is-dark" : "viewer-body is-light"}>
              <div className="viewer-image-shell">
                <img className={viewerImageClassName} src={assembledScoreUrl} alt="Full assembled guitar tab score" />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {processingState ? (
        <div className="processing-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="processing-panel">
            <p className="section-label">처리중</p>
            <h3 className="processing-title">{processingState.label}</h3>
            <p className="processing-detail">{processingState.detail}</p>
            <div className="processing-progress-meta">
              <span>{clampProgress(processingState.progressPercent)}%</span>
              {processingState.current != null && processingState.total != null ? (
                <span>
                  {processingState.current} / {processingState.total}
                  {processingState.unit ? ` ${processingState.unit}` : ""}
                </span>
              ) : (
                <span>{processingState.kind === "capture" ? "영상 캡처" : "악보 생성"}</span>
              )}
            </div>
            <div className="processing-progress-bar" aria-hidden="true">
              <div
                className="processing-progress-fill"
                style={{ width: `${clampProgress(processingState.progressPercent)}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FrameThumbnail({
  frame,
  isSelected,
  imageUrl,
  onSelect
}: {
  frame: ProjectFrameAsset;
  isSelected: boolean;
  imageUrl: string;
  onSelect: () => void;
}) {
  return (
    <button
      className={isSelected ? "thumbnail-card is-selected" : "thumbnail-card"}
      type="button"
      onClick={onSelect}
    >
      <img className="thumbnail-image" src={imageUrl} alt={`Frame at ${formatSeconds(frame.timestampSec)}`} />
      <span className="thumbnail-time">{formatSeconds(frame.timestampSec)}</span>
    </button>
  );
}
