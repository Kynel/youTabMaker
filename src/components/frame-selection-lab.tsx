"use client";

import { useEffect, useRef, useState } from "react";

import type {
  AssembledScoreAsset,
  AssemblyCropAsset,
  AssemblyEditorState,
  AssemblyReviewDecision,
  AssemblySequenceItem,
  DraftProject,
  ProjectFrameAsset,
  ProjectProcessingStatus,
  RoiSelection
} from "@/lib/types";

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

interface ManualEditGap {
  key: string;
  previous: AssemblySequenceItem | null;
  next: AssemblySequenceItem | null;
  missingBetweenCount: number;
  candidateCropIndices: number[];
}

interface ScoreSegmentRegion {
  cropIndex: number;
  timestampSec: number;
  topPercent: number;
  heightPercent: number;
  leftPercent: number;
  widthPercent: number;
}

interface ScoreGapRegion {
  key: string;
  topPercent: number;
  heightPercent: number;
  leftPercent: number;
  widthPercent: number;
}

interface FrameSelectionLabProps {
  project: DraftProject | null;
  onProjectUpdated: (project: DraftProject) => void;
  isCapturing: boolean;
  workspaceMode: "convert" | "edit";
  onRequestWorkspaceMode: (workspaceMode: "convert" | "edit") => void;
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

function toRawSelection(selection: RoiSelection): RawSelection {
  return {
    x: selection.x,
    y: selection.y,
    width: selection.width,
    height: selection.height
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

function formatReviewPercent(ratio: number) {
  return `${Math.max(0, Math.round(ratio * 100))}%`;
}

function buildGapKey(previousCropIndex: number | null, nextCropIndex: number | null) {
  return `${previousCropIndex ?? "start"}:${nextCropIndex ?? "end"}`;
}

function buildManualEditGaps(editor: AssemblyEditorState | undefined): ManualEditGap[] {
  if (!editor) {
    return [];
  }

  const includedCropIndices = new Set(editor.orderedCropIndices);
  const excludedCrops = editor.crops.filter((crop) => !includedCropIndices.has(crop.cropIndex));

  return Array.from({ length: editor.sequence.length + 1 }, (_, gapIndex) => {
    const previous = gapIndex > 0 ? editor.sequence[gapIndex - 1] ?? null : null;
    const next = gapIndex < editor.sequence.length ? editor.sequence[gapIndex] ?? null : null;
    const previousCropIndex = previous?.cropIndex ?? null;
    const nextCropIndex = next?.cropIndex ?? null;
    const primaryCandidates = excludedCrops.filter(
      (crop) =>
        (previousCropIndex == null || crop.cropIndex > previousCropIndex) &&
        (nextCropIndex == null || crop.cropIndex < nextCropIndex)
    );

    let candidateCropIndices = primaryCandidates.map((crop) => crop.cropIndex);

    if (candidateCropIndices.length === 0) {
      const center =
        previousCropIndex != null && nextCropIndex != null
          ? (previousCropIndex + nextCropIndex) / 2
          : previousCropIndex != null
            ? previousCropIndex + 1
            : nextCropIndex != null
              ? nextCropIndex - 1
              : 0;

      candidateCropIndices = [...excludedCrops]
        .sort(
          (left, right) =>
            Math.abs(left.cropIndex - center) - Math.abs(right.cropIndex - center) ||
            left.cropIndex - right.cropIndex
        )
        .slice(0, 8)
        .map((crop) => crop.cropIndex);
    } else {
      candidateCropIndices = candidateCropIndices.slice(0, 8);
    }

    return {
      key: buildGapKey(previousCropIndex, nextCropIndex),
      previous,
      next,
      missingBetweenCount: primaryCandidates.length,
      candidateCropIndices
    } satisfies ManualEditGap;
  });
}

function findCropByIndex(crops: AssemblyCropAsset[], cropIndex: number) {
  return crops.find((crop) => crop.cropIndex === cropIndex) ?? null;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildScoreOverlayLayout(
  editor: AssemblyEditorState | undefined,
  assembledScore: AssembledScoreAsset | undefined,
  gaps: ManualEditGap[]
) {
  if (!editor || !assembledScore || editor.sequence.length === 0) {
    return {
      segments: [] as ScoreSegmentRegion[],
      gaps: [] as ScoreGapRegion[]
    };
  }

  const normalizationWidth = Math.max(...editor.sequence.map((item) => item.width), 1);
  const contentHeight = editor.sequence.reduce(
    (sum, item) => sum + Math.max(1, item.height - item.overlapTrimTopPx) + item.gapBefore,
    0
  );
  const verticalPaddingTotal = Math.max(0, assembledScore.height - contentHeight);
  const topPadding = verticalPaddingTotal / 2;
  const bottomPadding = verticalPaddingTotal - topPadding;
  const horizontalPadding = Math.max(0, (assembledScore.width - normalizationWidth) / 2);
  const leftPercent = (horizontalPadding / Math.max(1, assembledScore.width)) * 100;
  const widthPercent = (normalizationWidth / Math.max(1, assembledScore.width)) * 100;
  const minimumGapHitHeight = 18;
  const segments: ScoreSegmentRegion[] = [];
  const gapRegions: ScoreGapRegion[] = [];

  if (gaps[0]) {
    const displayHeight = Math.max(minimumGapHitHeight, topPadding);
    const displayTop = clampNumber(topPadding / 2 - displayHeight / 2, 0, assembledScore.height - displayHeight);

    gapRegions.push({
      key: gaps[0].key,
      topPercent: (displayTop / Math.max(1, assembledScore.height)) * 100,
      heightPercent: (displayHeight / Math.max(1, assembledScore.height)) * 100,
      leftPercent,
      widthPercent
    });
  }

  let cursorTop = topPadding;

  editor.sequence.forEach((item, index) => {
    cursorTop += item.gapBefore;

    const appendedHeight = Math.max(1, item.height - item.overlapTrimTopPx);
    const itemTop = cursorTop;

    segments.push({
      cropIndex: item.cropIndex,
      timestampSec: item.timestampSec,
      topPercent: (itemTop / Math.max(1, assembledScore.height)) * 100,
      heightPercent: (appendedHeight / Math.max(1, assembledScore.height)) * 100,
      leftPercent,
      widthPercent
    });

    cursorTop += appendedHeight;

    const gap = gaps[index + 1];

    if (!gap) {
      return;
    }

    const nextGapHeight = index === editor.sequence.length - 1 ? bottomPadding : (editor.sequence[index + 1]?.gapBefore ?? 0);
    const displayHeight = Math.max(minimumGapHitHeight, nextGapHeight);
    const baseTop = nextGapHeight > 0 ? cursorTop : cursorTop - displayHeight / 2;
    const displayTop = clampNumber(baseTop, 0, assembledScore.height - displayHeight);

    gapRegions.push({
      key: gap.key,
      topPercent: (displayTop / Math.max(1, assembledScore.height)) * 100,
      heightPercent: (displayHeight / Math.max(1, assembledScore.height)) * 100,
      leftPercent,
      widthPercent
    });
  });

  return {
    segments,
    gaps: gapRegions
  };
}

export function FrameSelectionLab({
  project,
  onProjectUpdated,
  isCapturing,
  workspaceMode,
  onRequestWorkspaceMode
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
  const [isApplyingReview, setIsApplyingReview] = useState(false);
  const [isApplyingManualEdit, setIsApplyingManualEdit] = useState(false);
  const [isScoreViewerOpen, setIsScoreViewerOpen] = useState(false);
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>("dark");
  const [scoreColorMode, setScoreColorMode] = useState<ScoreColorMode>("original");
  const [isDownloadingScore, setIsDownloadingScore] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<Record<string, AssemblyReviewDecision>>({});
  const [activeGapKey, setActiveGapKey] = useState<string | null>(null);
  const [activeScoreCropIndex, setActiveScoreCropIndex] = useState<number | null>(null);

  const frames = project?.frames ?? [];
  const projectId = project?.id ?? null;
  const editor = project?.assemblyEditor;
  const reviewItems = project?.assemblyReview?.items ?? [];
  const manualEditGaps = buildManualEditGaps(editor);
  const activeGap = manualEditGaps.find((gap) => gap.key === activeGapKey) ?? null;
  const selectedSequenceItem =
    activeScoreCropIndex != null ? editor?.sequence.find((item) => item.cropIndex === activeScoreCropIndex) ?? null : null;
  const scoreOverlayLayout = buildScoreOverlayLayout(editor, project?.assembledScore, manualEditGaps);
  const orderedCropIndexSet = new Set(editor?.orderedCropIndices ?? []);
  const activeGapRegion = activeGapKey
    ? scoreOverlayLayout.gaps.find((gapRegion) => gapRegion.key === activeGapKey) ?? null
    : null;
  const activeGapPopupPosition = activeGapRegion
    ? {
        left: `${clampNumber(activeGapRegion.leftPercent + activeGapRegion.widthPercent / 2, 18, 82)}%`,
        top: `${clampNumber(activeGapRegion.topPercent + activeGapRegion.heightPercent / 2, 18, 82)}%`
      }
    : null;
  const assembledScoreUrl =
    project?.assembledScore && project
      ? `${projectAssetUrl(project.id, project.assembledScore.relativePath)}?v=${encodeURIComponent(
          project.assembledScore.generatedAt
        )}`
      : null;

  const selectedFrame =
    project && selectedFrameId ? frames.find((frame) => frame.id === selectedFrameId) ?? null : null;
  const shouldPollProcessing = Boolean(
    project && (isCapturing || isAssembling || isApplyingReview || isApplyingManualEdit || project.processing)
  );
  const processingState:
    | ProjectProcessingStatus
    | {
        kind: "capture" | "assemble";
        stage: string;
        label: string;
        detail: string;
        progressPercent: number;
        current?: number;
        total?: number;
        unit?: string;
      }
    | null =
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
        : isApplyingReview
          ? {
              kind: "assemble",
              stage: "reviewing",
              label: "검수 반영 중",
              detail: "의심 구간 선택을 저장하고 있습니다.",
              progressPercent: 4
            }
          : isApplyingManualEdit
            ? {
                kind: "assemble",
                stage: "editing",
                label: "악보 수정 중",
                detail: "추가/삭제한 tab 조각으로 악보를 다시 만들고 있습니다.",
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
    };
    nextImage.src = projectAssetUrl(project.id, selectedFrame.relativePath);
  }, [project?.id, selectedFrame?.id, selectedFrame?.relativePath]);

  useEffect(() => {
    if (!imageElement) {
      return;
    }

    if (project?.roi?.selection) {
      setSelection(toRawSelection(project.roi.selection));
      setSelectionMode(project.roi.selectionMode);
      return;
    }

    setSelection(buildBottomBandSelection(imageElement.naturalWidth, imageElement.naturalHeight));
    setSelectionMode("bottom-band-suggestion");
  }, [project?.id, project?.roi?.savedAt, imageElement]);

  useEffect(() => {
    if (!project?.assemblyReview) {
      setReviewDraft({});
      return;
    }

    setReviewDraft(
      project.assemblyReview.items.reduce(
        (accumulator, item) => {
          if (item.decision) {
            accumulator[item.id] = item.decision;
          }

          return accumulator;
        },
        {} as Record<string, AssemblyReviewDecision>
      )
    );
  }, [project?.id, project?.assemblyReview?.generatedAt]);

  useEffect(() => {
    if (!activeGapKey) {
      return;
    }

    if (!manualEditGaps.some((gap) => gap.key === activeGapKey)) {
      setActiveGapKey(null);
    }
  }, [activeGapKey, manualEditGaps]);

  useEffect(() => {
    if (activeScoreCropIndex == null) {
      return;
    }

    if (!editor?.sequence.some((item) => item.cropIndex === activeScoreCropIndex)) {
      setActiveScoreCropIndex(null);
    }
  }, [activeScoreCropIndex, editor?.generatedAt, editor?.sequence]);

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

  const unresolvedReviewCount = reviewItems.filter((item) => !reviewDraft[item.id]).length;
  const resolvedReviewCount = reviewItems.length - unresolvedReviewCount;
  const hasUnsavedReviewChanges = reviewItems.some(
    (item) => (reviewDraft[item.id] ?? null) !== (item.decision ?? null)
  );
  const requiresReviewConfirmation = reviewItems.length > 0;
  const manualInsertedCount = editor?.forcedCropIndices.length ?? 0;
  const isExportLocked =
    (requiresReviewConfirmation && (unresolvedReviewCount > 0 || hasUnsavedReviewChanges)) ||
    isApplyingManualEdit;
  const isConvertMode = workspaceMode === "convert";

  async function generateFullScore() {
    if (!project || !roi) {
      return;
    }

    setSelection(toRawSelection(roi));
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
      onRequestWorkspaceMode("edit");
      setStatusMessage(
        payload.project.assemblyReview?.totalCount
          ? `의심 구간 ${payload.project.assemblyReview.totalCount}개를 추렸습니다. 검수 후 PNG를 내보낼 수 있습니다.`
          : "영상 전체 tab를 하나의 악보로 완성했습니다."
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to assemble the full tab score."
      );
    } finally {
      setIsAssembling(false);
    }
  }

  async function applyReview() {
    if (!project || reviewItems.length === 0 || unresolvedReviewCount > 0) {
      return;
    }

    setIsApplyingReview(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          decisions: reviewDraft
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { project?: DraftProject; error?: string }
        | null;

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error ?? "Failed to apply the review decisions.");
      }

      onProjectUpdated(payload.project);
      setStatusMessage(
        payload.project.assemblyReview?.pendingCount
          ? `검수 선택을 저장했습니다. 남은 보류 ${payload.project.assemblyReview.pendingCount}개`
          : "의심 구간 검수를 반영했습니다."
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to apply the review decisions."
      );
    } finally {
      setIsApplyingReview(false);
    }
  }

  async function applyManualEdit(
    orderedCropIndices: number[],
    forcedCropIndices: number[],
    nextGapKey: string | null,
    successMessage: string
  ) {
    if (!project) {
      return;
    }

    setIsApplyingManualEdit(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/manual-edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orderedCropIndices,
          forcedCropIndices
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { project?: DraftProject; error?: string }
        | null;

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error ?? "Failed to apply the manual score edit.");
      }

      onProjectUpdated(payload.project);
      setActiveGapKey(nextGapKey);
      setStatusMessage(successMessage);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to apply the manual score edit.");
    } finally {
      setIsApplyingManualEdit(false);
    }
  }

  async function insertCropIntoGap(gap: ManualEditGap, cropIndex: number) {
    if (!editor) {
      return;
    }

    const insertAt =
      gap.previous?.cropIndex != null
        ? editor.orderedCropIndices.indexOf(gap.previous.cropIndex) + 1
        : 0;
    const nextOrderedCropIndices = [...editor.orderedCropIndices];
    nextOrderedCropIndices.splice(insertAt, 0, cropIndex);
    const nextForcedCropIndices = Array.from(new Set([...editor.forcedCropIndices, cropIndex])).sort(
      (left, right) => left - right
    );
    const nextGapKey = buildGapKey(cropIndex, gap.next?.cropIndex ?? null);
    const crop = findCropByIndex(editor.crops, cropIndex);

    await applyManualEdit(
      nextOrderedCropIndices,
      nextForcedCropIndices,
      nextGapKey,
      crop ? `${formatSeconds(crop.timestampSec)} 조각을 악보에 추가했습니다.` : "선택한 조각을 악보에 추가했습니다."
    );
    setActiveGapKey(null);
    setActiveScoreCropIndex(cropIndex);
  }

  async function removeCropFromSequence(cropIndex: number) {
    if (!editor || editor.orderedCropIndices.length <= 1) {
      return;
    }

    const cropPosition = editor.orderedCropIndices.indexOf(cropIndex);

    if (cropPosition < 0) {
      return;
    }

    const nextOrderedCropIndices = editor.orderedCropIndices.filter((currentCropIndex) => currentCropIndex !== cropIndex);
    const nextForcedCropIndices = editor.forcedCropIndices.filter((currentCropIndex) => currentCropIndex !== cropIndex);
    const previousCropIndex = cropPosition > 0 ? editor.orderedCropIndices[cropPosition - 1] ?? null : null;
    const nextCropIndex = editor.orderedCropIndices[cropPosition + 1] ?? null;
    setActiveScoreCropIndex(null);

    await applyManualEdit(
      nextOrderedCropIndices,
      nextForcedCropIndices,
      buildGapKey(previousCropIndex, nextCropIndex),
      "선택한 조각을 악보에서 제거했습니다."
    );
  }

  async function downloadScoreImage() {
    if (!assembledScoreUrl || isDownloadingScore || isExportLocked) {
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

  function updateReviewDecision(reviewId: string, decision: AssemblyReviewDecision) {
    setReviewDraft((currentDraft) => ({
      ...currentDraft,
      [reviewId]: decision
    }));
  }

  function applyRecommendedReviewChoices() {
    setReviewDraft((currentDraft) =>
      reviewItems.reduce(
        (accumulator, item) => {
          accumulator[item.id] = currentDraft[item.id] ?? item.recommendedDecision;
          return accumulator;
        },
        {} as Record<string, AssemblyReviewDecision>
      )
    );
  }

  function restoreSavedReviewChoices() {
    setReviewDraft(
      reviewItems.reduce(
        (accumulator, item) => {
          if (item.decision) {
            accumulator[item.id] = item.decision;
          }

          return accumulator;
        },
        {} as Record<string, AssemblyReviewDecision>
      )
    );
  }

  function activateGapEdit(gapKey: string) {
    setActiveScoreCropIndex(null);
    setActiveGapKey(gapKey);
  }

  function activateScoreCrop(cropIndex: number) {
    setActiveGapKey(null);
    setActiveScoreCropIndex(cropIndex);
  }

  function openFrameInConvertWorkspace(frameId: string | null) {
    if (!frameId) {
      return;
    }

    setSelectedFrameId(frameId);
    onRequestWorkspaceMode("convert");
  }

  const assembledImageClassName =
    scoreColorMode === "inverted" ? "assembled-image is-inverted" : "assembled-image";
  const viewerImageClassName = scoreColorMode === "inverted" ? "viewer-image is-inverted" : "viewer-image";
  const reviewImageClassName = scoreColorMode === "inverted" ? "review-image is-inverted" : "review-image";
  const previewShellClassName = previewBackground === "dark" ? "preview-shell is-dark" : "preview-shell is-light";
  const scoreShellClassName = previewBackground === "dark" ? "score-shell is-dark" : "score-shell is-light";
  const editorScoreShellClassName = `${scoreShellClassName} is-editor-layout`;
  const reviewFrameShellClassName =
    previewBackground === "dark" ? "review-frame-shell is-dark" : "review-frame-shell is-light";

  if (!project) {
    return (
      <section className="minimal-card">
        <div className="empty-box">
          {isConvertMode
            ? "URL을 넣고 영상을 불러오면 여기서 ROI를 선택할 수 있습니다."
            : "유튜브 변환 탭에서 먼저 영상을 불러오고 전체 Tab를 생성하세요."}
        </div>
      </section>
    );
  }

  const summaryText = project.assembledScore
    ? `${project.assembledScore.sourceFrameCount} -> ${project.assembledScore.stitchedFrameCount}${
        project.assemblyReview?.pendingCount ? ` / review ${project.assemblyReview.pendingCount}` : ""
      }`
    : frames.length > 0
      ? `${frames.length} frames`
      : isCapturing
      ? "capturing"
        : "ready";

  const reviewSection = project.assembledScore ? (
    <div className="section-block stack-xs">
      <div className="row-between">
        <div className="stack-xs">
          <p className="section-label">Overlap Review</p>
          <p className="muted">
            {reviewItems.length === 0
              ? "검수 필요 구간 없음"
              : `${reviewItems.length}개 중 ${resolvedReviewCount}개 선택 완료 / 보류 ${unresolvedReviewCount}개`}
          </p>
        </div>
        {reviewItems.length > 0 ? (
          <div className="action-row">
            <button className="ghost-button" type="button" onClick={applyRecommendedReviewChoices}>
              추천값 채우기
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={restoreSavedReviewChoices}
              disabled={!hasUnsavedReviewChanges}
            >
              되돌리기
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void applyReview()}
              disabled={
                unresolvedReviewCount > 0 ||
                !hasUnsavedReviewChanges ||
                isApplyingReview ||
                isApplyingManualEdit
              }
            >
              {isApplyingReview ? "반영 중" : "검수 반영"}
            </button>
          </div>
        ) : null}
      </div>

      {reviewItems.length === 0 ? (
        <div className="empty-box">자동 제거만으로 충분해서 추가 검수 없이 PNG를 내보낼 수 있습니다.</div>
      ) : (
        <div className="review-list">
          {reviewItems.map((item, index) => {
            const decision = reviewDraft[item.id];
            const previousCropUrl = projectAssetUrl(project.id, item.previousCropRelativePath);
            const currentCropUrl = projectAssetUrl(project.id, item.currentCropRelativePath);

            return (
              <article className="review-card stack-xs" key={item.id}>
                <div className="row-between">
                  <p className="section-label">검수 {index + 1}</p>
                  <p className="muted">
                    {formatSeconds(item.previousTimestampSec)}
                    {" -> "}
                    {formatSeconds(item.currentTimestampSec)}
                  </p>
                </div>
                <p className="review-detail">{item.reason}</p>
                <div className="review-meta-row">
                  <span>절삭 후보 {formatReviewPercent(item.overlapTrimRatio)}</span>
                  <span>유사도 {item.overlapScore.toFixed(3)}</span>
                </div>
                <div className="review-preview-grid">
                  <div className={reviewFrameShellClassName}>
                    <p className="review-frame-label">이전</p>
                    <img className={reviewImageClassName} src={previousCropUrl} alt="Previous tab segment" />
                  </div>
                  <div className={reviewFrameShellClassName}>
                    <p className="review-frame-label">현재</p>
                    <img className={reviewImageClassName} src={currentCropUrl} alt="Current tab segment" />
                  </div>
                </div>
                <div className="action-row">
                  <button
                    className={decision === "keep_both" ? "toggle-button is-active" : "toggle-button"}
                    type="button"
                    onClick={() => updateReviewDecision(item.id, "keep_both")}
                  >
                    둘 다 유지
                  </button>
                  <button
                    className={decision === "trim_overlap" ? "toggle-button is-active" : "toggle-button"}
                    type="button"
                    onClick={() => updateReviewDecision(item.id, "trim_overlap")}
                  >
                    겹침 제거
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  const manualEditSection = project.assembledScore && editor ? (
    <div className="section-block stack-xs">
      <div className="row-between">
        <div className="stack-xs">
          <p className="section-label">Manual Edit</p>
          <p className="muted">
            중앙의 전체 악보에서 조각을 클릭하면 제거, 조각 사이의 `+`를 클릭하면 추가 후보를 엽니다.
          </p>
        </div>
        {selectedSequenceItem || activeGap ? (
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setActiveScoreCropIndex(null);
              setActiveGapKey(null);
            }}
          >
            선택 해제
          </button>
        ) : null}
      </div>

      {selectedSequenceItem ? (
        <div className="manual-editor-panel stack-xs">
          <div className="row-between">
            <div className="stack-xs">
              <p className="section-label">선택한 조각</p>
              <p className="muted">
                {formatSeconds(selectedSequenceItem.timestampSec)}
                {selectedSequenceItem.trimMode === "manual" ? " / 수동 추가 조각" : " / 현재 악보 조각"}
              </p>
            </div>
          </div>

          <div className="review-preview-grid">
            <div className={reviewFrameShellClassName}>
              <p className="review-frame-label">{formatSeconds(selectedSequenceItem.timestampSec)}</p>
              <img
                className={reviewImageClassName}
                src={projectAssetUrl(project.id, selectedSequenceItem.relativePath)}
                alt="Selected score segment"
              />
            </div>
          </div>

          <div className="action-row">
            <button
              className="ghost-button"
              type="button"
              onClick={() => openFrameInConvertWorkspace(selectedSequenceItem.frameId)}
            >
              프레임 보기
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void removeCropFromSequence(selectedSequenceItem.cropIndex)}
              disabled={isApplyingManualEdit || editor.orderedCropIndices.length <= 1}
            >
              제거
            </button>
          </div>
        </div>
      ) : (
        <div className="empty-box">
          현재 조각 {editor.sequence.length}개 / 수동 추가 {manualInsertedCount}개. 큰 악보에서 조각을 누르면 제거,
          `+`를 누르면 추가 팝업이 바로 열립니다.
        </div>
      )}
    </div>
  ) : null;

  return (
    <section className="minimal-card stack-sm">
      {isConvertMode ? (
        <>
          <div className="row-between">
            <h2 className="section-title">유튜브 변환</h2>
            <p className="status-line">{summaryText}</p>
          </div>

          <div className="section-block stack-xs">
            <div className="row-between">
              <p className="section-label">Captured Frames</p>
              <p className="muted">
                {isCapturing ? "추출 중" : selectedFrame ? formatSeconds(selectedFrame.timestampSec) : ""}
              </p>
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
                    imageUrl={projectAssetUrl(project.id, frame.relativePath)}
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
              <button
                className="primary-button"
                type="button"
                onClick={() => void generateFullScore()}
                disabled={!roi || isAssembling || isApplyingReview || isApplyingManualEdit}
              >
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
              <div className={previewShellClassName}>
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
              {project.assembledScore && assembledScoreUrl ? (
                <>
                  <div className={scoreShellClassName}>
                    <img className={assembledImageClassName} src={assembledScoreUrl} alt="Assembled guitar tab score" />
                  </div>
                  <div className="action-row">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => onRequestWorkspaceMode("edit")}
                    >
                      악보 수정 탭
                    </button>
                    <button className="ghost-button" type="button" onClick={() => setIsScoreViewerOpen(true)}>
                      크게 보기
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void downloadScoreImage()}
                      disabled={isDownloadingScore || isExportLocked}
                    >
                      {isDownloadingScore ? "PNG 생성 중" : "PNG"}
                    </button>
                  </div>
                  {isExportLocked ? (
                    <p className="muted">의심 구간 검수를 반영한 뒤 PNG를 내보낼 수 있습니다.</p>
                  ) : null}
                </>
              ) : (
                <div className={scoreShellClassName}>
                  <p className="preview-empty">결과 없음</p>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="row-between">
            <div className="stack-xs">
              <h2 className="section-title">악보 수정</h2>
              <p className="muted">
                전체 악보 레이아웃을 크게 보면서 검수와 수동 추가/삭제를 빠르게 진행합니다.
              </p>
            </div>
            <div className="action-row">
              <button className="ghost-button" type="button" onClick={() => onRequestWorkspaceMode("convert")}>
                유튜브 변환 탭
              </button>
              <p className="status-line">{summaryText}</p>
            </div>
          </div>

          {project.assembledScore && assembledScoreUrl ? (
            <div className="section-block stack-xs">
              <div className="row-between">
                <div className="stack-xs">
                  <p className="section-label">전체 Tab</p>
                  <p className="muted">
                    {project.assembledScore.sourceFrameCount}
                    {" -> "}
                    {project.assembledScore.stitchedFrameCount}
                    {manualInsertedCount > 0 ? ` / 수동 추가 ${manualInsertedCount}` : ""}
                  </p>
                </div>
                <div className="editor-toolbar">
                  <div className="toggle-group" role="group" aria-label="Score background">
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
                  <button className="ghost-button" type="button" onClick={() => setIsScoreViewerOpen(true)}>
                    크게 보기
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void downloadScoreImage()}
                    disabled={isDownloadingScore || isExportLocked}
                  >
                    {isDownloadingScore ? "PNG 생성 중" : "PNG"}
                  </button>
                </div>
              </div>

              <div className={editorScoreShellClassName}>
                <div className="score-editor-canvas">
                  <img className={assembledImageClassName} src={assembledScoreUrl} alt="Assembled guitar tab score" />
                  <div className="score-editor-overlay">
                    {scoreOverlayLayout.segments.map((region) => (
                      <button
                        key={`segment-${region.cropIndex}`}
                        className={
                          activeScoreCropIndex === region.cropIndex
                            ? "score-region-button is-active"
                            : "score-region-button"
                        }
                        type="button"
                        style={{
                          top: `${region.topPercent}%`,
                          height: `${region.heightPercent}%`,
                          left: `${region.leftPercent}%`,
                          width: `${region.widthPercent}%`
                        }}
                        onClick={() => activateScoreCrop(region.cropIndex)}
                        aria-label={`${formatSeconds(region.timestampSec)} 조각 선택`}
                      >
                        <span className="score-region-label">{formatSeconds(region.timestampSec)}</span>
                      </button>
                    ))}
                    {scoreOverlayLayout.gaps.map((gapRegion) => (
                      <button
                        key={`gap-${gapRegion.key}`}
                        className={activeGapKey === gapRegion.key ? "score-gap-button is-active" : "score-gap-button"}
                        type="button"
                        style={{
                          top: `${gapRegion.topPercent}%`,
                          height: `${gapRegion.heightPercent}%`,
                          left: `${gapRegion.leftPercent}%`,
                          width: `${gapRegion.widthPercent}%`
                        }}
                        onClick={() => activateGapEdit(gapRegion.key)}
                        aria-label="여기에 조각 추가"
                      >
                        <span className="score-gap-label">+</span>
                      </button>
                    ))}
                  </div>
                  {activeGap && activeGapPopupPosition ? (
                    <>
                      <button
                        className="score-popup-backdrop"
                        type="button"
                        aria-label="추가 팝업 닫기"
                        onClick={() => setActiveGapKey(null)}
                      />
                      <div
                        className="score-gap-popup"
                        style={activeGapPopupPosition}
                        role="dialog"
                        aria-modal="false"
                        aria-label="추가할 조각 선택"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="row-between">
                          <div className="stack-xs">
                            <p className="section-label">추가할 조각 선택</p>
                            <p className="muted">1초 간격으로 잘라둔 전체 crop를 시간순으로 모두 보여줍니다.</p>
                          </div>
                          <button className="ghost-button" type="button" onClick={() => setActiveGapKey(null)}>
                            닫기
                          </button>
                        </div>

                        <div className="review-preview-grid">
                          <div className={reviewFrameShellClassName}>
                            <p className="review-frame-label">
                              {activeGap.previous ? `이전 ${formatSeconds(activeGap.previous.timestampSec)}` : "시작"}
                            </p>
                            {activeGap.previous ? (
                              <>
                                <img
                                  className={reviewImageClassName}
                                  src={projectAssetUrl(project.id, activeGap.previous.relativePath)}
                                  alt="Previous score segment"
                                />
                                <div className="action-row">
                                  <button
                                    className="ghost-button"
                                    type="button"
                                    onClick={() => openFrameInConvertWorkspace(activeGap.previous?.frameId ?? null)}
                                  >
                                    프레임
                                  </button>
                                </div>
                              </>
                            ) : (
                              <p className="preview-empty">악보 시작 지점</p>
                            )}
                          </div>
                          <div className={reviewFrameShellClassName}>
                            <p className="review-frame-label">
                              {activeGap.next ? `다음 ${formatSeconds(activeGap.next.timestampSec)}` : "끝"}
                            </p>
                            {activeGap.next ? (
                              <>
                                <img
                                  className={reviewImageClassName}
                                  src={projectAssetUrl(project.id, activeGap.next.relativePath)}
                                  alt="Next score segment"
                                />
                                <div className="action-row">
                                  <button
                                    className="ghost-button"
                                    type="button"
                                    onClick={() => openFrameInConvertWorkspace(activeGap.next?.frameId ?? null)}
                                  >
                                    프레임
                                  </button>
                                </div>
                              </>
                            ) : (
                              <p className="preview-empty">악보 마지막 뒤</p>
                            )}
                          </div>
                        </div>

                        <div className="gap-popup-grid">
                          {(editor?.crops ?? []).map((crop) => {
                            const isAlreadyIncluded = orderedCropIndexSet.has(crop.cropIndex);

                            return (
                              <article
                                className={isAlreadyIncluded ? "candidate-card stack-xs is-included" : "candidate-card stack-xs"}
                                key={crop.cropIndex}
                              >
                                <div className={reviewFrameShellClassName}>
                                  <p className="review-frame-label">{formatSeconds(crop.timestampSec)}</p>
                                  <img
                                    className={reviewImageClassName}
                                    src={projectAssetUrl(project.id, crop.relativePath)}
                                    alt="Candidate score segment"
                                    loading="lazy"
                                  />
                                </div>
                                <div className="action-row">
                                  <button
                                    className="ghost-button"
                                    type="button"
                                    onClick={() => openFrameInConvertWorkspace(crop.frameId)}
                                  >
                                    프레임
                                  </button>
                                  <button
                                    className="primary-button"
                                    type="button"
                                    onClick={() => void insertCropIntoGap(activeGap, crop.cropIndex)}
                                    disabled={isApplyingManualEdit || isAlreadyIncluded}
                                  >
                                    {isAlreadyIncluded ? "포함됨" : "추가"}
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <p className="muted">조각 클릭: 제거 후보 선택 / `+` 클릭: 이 위치에 추가할 후보 열기</p>

              {isExportLocked ? (
                <p className="muted">의심 구간 검수를 반영한 뒤 PNG를 내보낼 수 있습니다.</p>
              ) : null}
            </div>
          ) : (
            <div className="empty-box">유튜브 변환 탭에서 먼저 전체 Tab를 생성하세요.</div>
          )}

          {statusMessage ? <div className="status-box">{statusMessage}</div> : null}
          {reviewSection}
          {manualEditSection}
        </>
      )}

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
                  disabled={isDownloadingScore || isExportLocked}
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
