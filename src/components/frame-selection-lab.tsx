"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  Eye,
  EyeOff,
  Film,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  ScrollText,
  X
} from "lucide-react";

import { areRoiSelectionsEqual, findActiveRoiSegment, getProjectRoiSegments } from "@/lib/roi";
import type {
  AssembledScoreAsset,
  AssemblyCropAsset,
  AssemblyEditorState,
  AssemblySequenceItem,
  DraftProject,
  ProjectFrameAsset,
  ProjectProcessingStatus,
  RoiSelection,
  SavedRoiSegment
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
type ViewerMode = "scroll" | "page";
type GapPreviewTarget =
  | { kind: "candidate"; cropIndex: number }
  | { kind: "previous" }
  | { kind: "next" };

const VIEWER_PAGE_ASPECT_RATIO = 1.414;
const VIEWER_PAGE_GAP_PX = 12;
const VIEWER_AUTO_SCROLL_MIN = 2;
const VIEWER_AUTO_SCROLL_MAX = 160;
const VIEWER_AUTO_SCROLL_STEP = 2;
const VIEWER_AUTO_SCROLL_DEFAULT = 48;
const VIEWER_SCROLL_ZOOM_MIN = 40;
const VIEWER_SCROLL_ZOOM_MAX = 320;
const VIEWER_SCROLL_ZOOM_STEP = 20;

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

function clampRawSelectionToBounds(selection: RawSelection, boundsWidth: number, boundsHeight: number): RawSelection {
  const normalized = normalizeRect(selection);
  const left = clampNumber(normalized.x, 0, boundsWidth);
  const top = clampNumber(normalized.y, 0, boundsHeight);
  const right = clampNumber(normalized.x + normalized.width, 0, boundsWidth);
  const bottom = clampNumber(normalized.y + normalized.height, 0, boundsHeight);

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
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

function formatRoiSelectionModeLabel(selectionMode: "manual" | "bottom-band-suggestion") {
  return selectionMode === "bottom-band-suggestion" ? "자동 제안" : "수동 지정";
}

function findClosestFrameForSegment(frames: ProjectFrameAsset[], segment: SavedRoiSegment) {
  return (
    frames.find((frame) => frame.id === segment.startFrameId) ??
    frames.find((frame) => frame.timestampSec >= segment.startTimestampSec) ??
    frames.at(-1) ??
    null
  );
}

function clampProgress(progressPercent: number | undefined) {
  if (typeof progressPercent !== "number" || !Number.isFinite(progressPercent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(progressPercent)));
}

function formatViewerScrollSpeed(speed: number) {
  return `${Math.round(speed)} px/s`;
}

function normalizeSliderValue(value: number, minimum: number, maximum: number, step: number) {
  const clampedValue = clampNumber(value, minimum, maximum);
  const normalizedStep = Math.max(1, step);
  const steppedValue =
    Math.round((clampedValue - minimum) / normalizedStep) * normalizedStep + minimum;

  return clampNumber(steppedValue, minimum, maximum);
}

interface ViewerSpeedSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  variant?: "default" | "compact";
}

function ViewerSpeedSlider({
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
  variant = "default"
}: ViewerSpeedSliderProps) {
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const range = Math.max(1, max - min);
  const percentage = ((value - min) / range) * 100;

  function updateValueFromClientX(clientX: number) {
    const sliderElement = sliderRef.current;

    if (!sliderElement) {
      return;
    }

    const bounds = sliderElement.getBoundingClientRect();
    const relativeRatio = clampNumber((clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    const nextValue = normalizeSliderValue(min + range * relativeRatio, min, max, step);

    onChange(nextValue);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    updateValueFromClientX(event.clientX);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDragging) {
      return;
    }

    updateValueFromClientX(event.clientX);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDragging) {
      return;
    }

    updateValueFromClientX(event.clientX);
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(normalizeSliderValue(value - step, min, max, step));
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(normalizeSliderValue(value + step, min, max, step));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onChange(max);
    }
  }

  return (
    <div
      className={
        isDragging
          ? variant === "compact"
            ? "viewer-custom-slider is-dragging is-compact"
            : "viewer-custom-slider is-dragging"
          : variant === "compact"
            ? "viewer-custom-slider is-compact"
            : "viewer-custom-slider"
      }
    >
      <div
        ref={sliderRef}
        className="viewer-custom-slider-track"
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatViewerScrollSpeed(value)}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="viewer-custom-slider-rail" />
        <div className="viewer-custom-slider-fill" style={{ width: `${percentage}%` }} />
        <div className="viewer-custom-slider-thumb" style={{ left: `${percentage}%` }} />
      </div>
    </div>
  );
}

function buildGapKey(previousCropIndex: number | null, nextCropIndex: number | null) {
  return `${previousCropIndex ?? "start"}:${nextCropIndex ?? "end"}`;
}

function buildManualEditGaps(editor: AssemblyEditorState | undefined): ManualEditGap[] {
  if (!editor) {
    return [];
  }

  const includedCropIndices = new Set(editor.orderedCropIndices);
  const excludedCrops = editor.crops
    .filter((crop) => !includedCropIndices.has(crop.cropIndex))
    .sort((left, right) => left.timestampSec - right.timestampSec || left.cropIndex - right.cropIndex);

  return Array.from({ length: editor.sequence.length + 1 }, (_, gapIndex) => {
    const previous = gapIndex > 0 ? editor.sequence[gapIndex - 1] ?? null : null;
    const next = gapIndex < editor.sequence.length ? editor.sequence[gapIndex] ?? null : null;
    const previousTimestampSec = previous?.timestampSec ?? null;
    const nextTimestampSec = next?.timestampSec ?? null;
    const primaryCandidates = excludedCrops.filter(
      (crop) =>
        (previousTimestampSec == null || crop.timestampSec > previousTimestampSec) &&
        (nextTimestampSec == null || crop.timestampSec < nextTimestampSec)
    );

    return {
      key: buildGapKey(previous?.cropIndex ?? null, next?.cropIndex ?? null),
      previous,
      next,
      missingBetweenCount: primaryCandidates.length,
      candidateCropIndices: primaryCandidates.map((crop) => crop.cropIndex)
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
  const viewerBodyRef = useRef<HTMLDivElement | null>(null);
  const viewerAutoScrollPositionRef = useRef(0);
  const viewerTapGestureRef = useRef<{ pointerId: number | null; startX: number; startY: number; moved: boolean }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    moved: false
  });
  const roiSelectionSyncKeyRef = useRef<string | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [selection, setSelection] = useState<RawSelection | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<"manual" | "bottom-band-suggestion">("manual");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSavingRoi, setIsSavingRoi] = useState(false);
  const [deletingRoiSegmentId, setDeletingRoiSegmentId] = useState<string | null>(null);
  const [isAssembling, setIsAssembling] = useState(false);
  const [isApplyingManualEdit, setIsApplyingManualEdit] = useState(false);
  const [isScoreViewerOpen, setIsScoreViewerOpen] = useState(false);
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>("dark");
  const [scoreColorMode, setScoreColorMode] = useState<ScoreColorMode>("original");
  const [isDownloadingScore, setIsDownloadingScore] = useState(false);
  const [activeGapKey, setActiveGapKey] = useState<string | null>(null);
  const [activeScoreCropIndex, setActiveScoreCropIndex] = useState<number | null>(null);
  const [activeGapPreviewTarget, setActiveGapPreviewTarget] = useState<GapPreviewTarget | null>(null);
  const [viewerMode, setViewerMode] = useState<ViewerMode>("scroll");
  const [viewerPageSpread, setViewerPageSpread] = useState<1 | 2>(1);
  const [viewerPageStartIndex, setViewerPageStartIndex] = useState(0);
  const [viewerAutoScrollEnabled, setViewerAutoScrollEnabled] = useState(false);
  const [viewerAutoScrollSpeed, setViewerAutoScrollSpeed] = useState<number>(VIEWER_AUTO_SCROLL_DEFAULT);
  const [viewerScrollZoomPercent, setViewerScrollZoomPercent] = useState(100);
  const [isViewerToolbarHidden, setIsViewerToolbarHidden] = useState(false);
  const [viewerViewport, setViewerViewport] = useState({ width: 0, height: 0 });

  const frames = project?.frames ?? [];
  const projectId = project?.id ?? null;
  const roiSegments = getProjectRoiSegments(project);
  const editor = project?.assemblyEditor;
  const manualEditGaps = buildManualEditGaps(editor);
  const usedFrameIdSet = new Set(editor?.sequence.map((item) => item.frameId) ?? []);
  const failedAssemblyFrameIdSet = new Set(project?.assemblyFailure?.failedFrameIds ?? []);
  const activeGap = manualEditGaps.find((gap) => gap.key === activeGapKey) ?? null;
  const activeGapCandidateCrops =
    activeGap && editor
      ? activeGap.candidateCropIndices
          .map((cropIndex) => findCropByIndex(editor.crops, cropIndex))
          .filter((crop): crop is AssemblyCropAsset => Boolean(crop))
      : [];
  const activeGapPreviewItem =
    activeGap && activeGapPreviewTarget
      ? activeGapPreviewTarget.kind === "previous"
        ? activeGap.previous
        : activeGapPreviewTarget.kind === "next"
          ? activeGap.next
          : activeGapCandidateCrops.find((crop) => crop.cropIndex === activeGapPreviewTarget.cropIndex) ?? null
      : null;
  const scoreOverlayLayout = buildScoreOverlayLayout(editor, project?.assembledScore, manualEditGaps);
  const assembledScoreUrl =
    project?.assembledScore && project
      ? `${projectAssetUrl(project.id, project.assembledScore.relativePath)}?v=${encodeURIComponent(
          project.assembledScore.generatedAt
        )}`
      : null;
  const assembledScoreWidth = project?.assembledScore?.width ?? 0;
  const assembledScoreHeight = project?.assembledScore?.height ?? 0;
  const viewerAvailableWidth = Math.max(0, viewerViewport.width);
  const viewerAvailableHeight = Math.max(0, viewerViewport.height);
  const viewerPageWidth =
    viewerMode === "page" && viewerAvailableWidth > 0 && viewerAvailableHeight > 0
      ? Math.max(
          0,
          Math.min(
            (viewerAvailableWidth - VIEWER_PAGE_GAP_PX * (viewerPageSpread - 1)) / viewerPageSpread,
            viewerAvailableHeight / VIEWER_PAGE_ASPECT_RATIO
          )
        )
      : 0;
  const viewerPageHeight =
    viewerMode === "page" ? Math.max(0, viewerPageWidth * VIEWER_PAGE_ASPECT_RATIO) : 0;
  const viewerSourcePageHeight =
    assembledScoreWidth > 0 ? assembledScoreWidth * VIEWER_PAGE_ASPECT_RATIO : 0;
  const viewerPageCount =
    viewerMode === "page" && viewerSourcePageHeight > 0
      ? Math.max(1, Math.ceil(assembledScoreHeight / viewerSourcePageHeight))
      : 0;
  const viewerVisiblePageIndices =
    viewerMode === "page" && viewerPageCount > 0
      ? Array.from({ length: viewerPageSpread }, (_, index) => viewerPageStartIndex + index).filter(
          (pageIndex) => pageIndex < viewerPageCount
        )
      : [];
  const viewerVisiblePageEndIndex =
    viewerMode === "page" && viewerPageCount > 0 ? Math.min(viewerPageCount, viewerPageStartIndex + viewerPageSpread) : 0;
  const viewerPageRangeLabel =
    viewerMode === "page" && viewerPageCount > 0 ? `${viewerPageStartIndex + 1}-${viewerVisiblePageEndIndex} / ${viewerPageCount}` : "0 / 0";
  const viewerStatusLabel =
    viewerMode === "scroll"
      ? `${viewerAutoScrollEnabled ? "자동 스크롤" : "수동 보기"} · ${formatViewerScrollSpeed(
          viewerAutoScrollSpeed
        )} · ${viewerScrollZoomPercent}%`
      : `${viewerPageSpread === 2 ? "2페이지" : "1페이지"} · ${viewerPageRangeLabel}`;
  const canViewerGoPrevious = viewerMode === "page" && viewerPageStartIndex > 0;
  const canViewerGoNext =
    viewerMode === "page" &&
    viewerPageCount > 0 &&
    viewerPageStartIndex + viewerPageSpread < viewerPageCount;
  const canRemoveSequenceCrop = Boolean(editor && editor.orderedCropIndices.length > 1);

  const selectedFrame =
    project && selectedFrameId ? frames.find((frame) => frame.id === selectedFrameId) ?? null : null;
  const activeRoiSegment =
    selectedFrame != null
      ? findActiveRoiSegment(roiSegments, selectedFrame.timestampSec)
      : roiSegments[0] ?? null;
  const activeProcessing = project?.processing?.stage === "failed" ? undefined : project?.processing;
  const shouldPollProcessing = Boolean(
    project && (isCapturing || isAssembling || isApplyingManualEdit || activeProcessing)
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
    activeProcessing ??
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
    if (project?.processing?.stage !== "failed") {
      return;
    }

    setStatusMessage((currentMessage) => currentMessage ?? project.processing?.detail ?? "처리에 실패했습니다.");
  }, [project?.processing?.detail, project?.processing?.stage]);

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
    roiSelectionSyncKeyRef.current = null;
  }, [project?.id]);

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

    const syncKey = activeRoiSegment
      ? `${project?.id ?? "project"}:${selectedFrame?.id ?? "frame"}:${activeRoiSegment.id}:${activeRoiSegment.savedAt}`
      : `${project?.id ?? "project"}:unsaved:${imageElement.naturalWidth}x${imageElement.naturalHeight}`;

    if (roiSelectionSyncKeyRef.current === syncKey) {
      return;
    }

    roiSelectionSyncKeyRef.current = syncKey;

    if (activeRoiSegment) {
      setSelection(
        clampRawSelectionToBounds(
          toRawSelection(activeRoiSegment.selection),
          imageElement.naturalWidth,
          imageElement.naturalHeight
        )
      );
      setSelectionMode(activeRoiSegment.selectionMode);
      return;
    }

    setSelection(buildBottomBandSelection(imageElement.naturalWidth, imageElement.naturalHeight));
    setSelectionMode("bottom-band-suggestion");
  }, [activeRoiSegment?.id, activeRoiSegment?.savedAt, imageElement, project?.id, selectedFrame?.id]);

  useEffect(() => {
    if (!activeGapKey) {
      setActiveGapPreviewTarget(null);
      return;
    }

    if (!manualEditGaps.some((gap) => gap.key === activeGapKey)) {
      setActiveGapKey(null);
    }
  }, [activeGapKey, manualEditGaps]);

  useEffect(() => {
    if (!activeGapKey) {
      setActiveGapPreviewTarget(null);
      return;
    }
  }, [activeGapKey]);

  useEffect(() => {
    if (!activeGap || !activeGapPreviewTarget) {
      return;
    }

    if (activeGapPreviewTarget.kind === "previous" && !activeGap.previous) {
      setActiveGapPreviewTarget(null);
      return;
    }

    if (activeGapPreviewTarget.kind === "next" && !activeGap.next) {
      setActiveGapPreviewTarget(null);
      return;
    }

    if (
      activeGapPreviewTarget.kind === "candidate" &&
      !activeGapCandidateCrops.some((crop) => crop.cropIndex === activeGapPreviewTarget.cropIndex)
    ) {
      setActiveGapPreviewTarget(null);
    }
  }, [activeGap, activeGapCandidateCrops, activeGapPreviewTarget]);

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
      setViewerAutoScrollEnabled(false);
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
    if (!isScoreViewerOpen) {
      return;
    }

    setViewerMode("scroll");
    setViewerPageSpread(1);
    setViewerPageStartIndex(0);
    setViewerAutoScrollEnabled(false);
    setViewerScrollZoomPercent(100);
    setIsViewerToolbarHidden(false);

    const body = viewerBodyRef.current;

    if (body) {
      body.scrollTop = 0;
      body.scrollLeft = 0;
    }

    viewerAutoScrollPositionRef.current = 0;
  }, [isScoreViewerOpen, assembledScoreUrl]);

  useEffect(() => {
    if (!isScoreViewerOpen) {
      return;
    }

    const body = viewerBodyRef.current;

    if (!body) {
      return;
    }

    const updateViewerViewport = () => {
      setViewerViewport({
        width: body.clientWidth,
        height: body.clientHeight
      });
    };

    updateViewerViewport();

    const resizeObserver = new ResizeObserver(() => {
      updateViewerViewport();
    });

    resizeObserver.observe(body);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isScoreViewerOpen, viewerMode, viewerPageSpread]);

  useEffect(() => {
    if (viewerMode !== "scroll" && viewerAutoScrollEnabled) {
      setViewerAutoScrollEnabled(false);
    }
  }, [viewerMode, viewerAutoScrollEnabled]);

  useEffect(() => {
    if (viewerMode !== "page") {
      return;
    }

    setViewerPageStartIndex((currentPageStartIndex) => {
      const maximumStartIndex = Math.max(0, viewerPageCount - 1);
      const normalizedPageStartIndex = Math.min(Math.max(0, currentPageStartIndex), maximumStartIndex);

      if (viewerPageSpread === 2) {
        return Math.max(0, normalizedPageStartIndex - (normalizedPageStartIndex % 2));
      }

      return normalizedPageStartIndex;
    });
  }, [viewerMode, viewerPageCount, viewerPageSpread]);

  useEffect(() => {
    if (!isScoreViewerOpen || viewerMode !== "scroll" || !viewerAutoScrollEnabled) {
      return;
    }

    const body = viewerBodyRef.current;

    if (!body) {
      return;
    }

    let animationFrameId = 0;
    let previousTimestamp = performance.now();
    viewerAutoScrollPositionRef.current = body.scrollTop;

    const tick = (timestamp: number) => {
      const elapsedSeconds = (timestamp - previousTimestamp) / 1000;
      previousTimestamp = timestamp;

      const maximumScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);

      if (maximumScrollTop <= 0) {
        setViewerAutoScrollEnabled(false);
        return;
      }

      viewerAutoScrollPositionRef.current = Math.min(
        maximumScrollTop,
        viewerAutoScrollPositionRef.current + viewerAutoScrollSpeed * elapsedSeconds
      );

      const nextScrollTop = viewerAutoScrollPositionRef.current;
      body.scrollTop = nextScrollTop;

      if (nextScrollTop >= maximumScrollTop - 1) {
        setViewerAutoScrollEnabled(false);
        return;
      }

      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [isScoreViewerOpen, viewerMode, viewerAutoScrollEnabled, viewerAutoScrollSpeed]);

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
  }, [imageElement, selection, workspaceMode]);

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
  }, [imageElement, selection, workspaceMode]);

  function getCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canvasRef.current || !imageElement) {
      return null;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = imageElement.naturalWidth / rect.width;
    const scaleY = imageElement.naturalHeight / rect.height;

    return {
      x: clampNumber((event.clientX - rect.left) * scaleX, 0, imageElement.naturalWidth),
      y: clampNumber((event.clientY - rect.top) * scaleY, 0, imageElement.naturalHeight)
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
    if (activeRoiSegment) {
      setSelection(
        clampRawSelectionToBounds(
          toRawSelection(activeRoiSegment.selection),
          imageElement?.naturalWidth ?? activeRoiSegment.selection.x + activeRoiSegment.selection.width,
          imageElement?.naturalHeight ?? activeRoiSegment.selection.y + activeRoiSegment.selection.height
        )
      );
      setSelectionMode(activeRoiSegment.selectionMode);
      setStatusMessage("저장된 ROI로 되돌렸습니다.");
      return;
    }

    setSelection(null);
    setSelectionMode("manual");
  }

  function buildRoiSelection(): RoiSelection | null {
    if (!imageElement || !selection) {
      return null;
    }

    const normalized = clampRawSelectionToBounds(selection, imageElement.naturalWidth, imageElement.naturalHeight);

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
  const hasSavedRoiSegments = roiSegments.length > 0;
  const hasUnsavedRoiChanges = Boolean(
    roi &&
      (!activeRoiSegment ||
        !areRoiSelectionsEqual(roi, activeRoiSegment.selection) ||
        selectionMode !== activeRoiSegment.selectionMode)
  );
  const canGenerateFullScore = Boolean(
    project && ((hasSavedRoiSegments && !hasUnsavedRoiChanges) || (!hasSavedRoiSegments && roi))
  );

  const manualInsertedCount = editor?.forcedCropIndices.length ?? 0;
  const isExportLocked = isApplyingManualEdit;
  const isConvertMode = workspaceMode === "convert";

  async function saveRoiSegment(action: "replace-active" | "insert-from-current") {
    if (!project || !roi) {
      return;
    }

    const selectedOrFirstFrame = selectedFrame ?? frames[0] ?? null;
    const startTimestampSec =
      action === "insert-from-current"
        ? selectedOrFirstFrame?.timestampSec ?? 0
        : activeRoiSegment?.startTimestampSec ?? 0;
    const startFrameId =
      action === "insert-from-current"
        ? selectedOrFirstFrame?.id ?? null
        : activeRoiSegment?.startFrameId ?? selectedOrFirstFrame?.id ?? null;
    const normalizedStartFrameId =
      action === "replace-active" && !activeRoiSegment
        ? frames[0]?.id ?? startFrameId
        : startFrameId;

    setIsSavingRoi(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/roi`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          roi,
          selectionMode,
          startTimestampSec,
          startFrameId: normalizedStartFrameId
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { project?: DraftProject; error?: string }
        | null;

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error ?? "ROI 구간을 저장하지 못했습니다.");
      }

      onProjectUpdated(payload.project);
      setStatusMessage(
        action === "insert-from-current"
          ? `${formatSeconds(startTimestampSec)}부터 새 ROI 구간을 저장했습니다.`
          : "현재 ROI 구간을 저장했습니다."
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "ROI 구간을 저장하지 못했습니다.");
    } finally {
      setIsSavingRoi(false);
    }
  }

  async function deleteRoiSegment(segmentId: string) {
    if (!project) {
      return;
    }

    setDeletingRoiSegmentId(segmentId);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/roi`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          segmentId
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { project?: DraftProject; error?: string }
        | null;

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error ?? "ROI 구간을 삭제하지 못했습니다.");
      }

      onProjectUpdated(payload.project);
      setStatusMessage("선택한 ROI 구간을 삭제했습니다.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "ROI 구간을 삭제하지 못했습니다.");
    } finally {
      setDeletingRoiSegmentId((currentSegmentId) => (currentSegmentId === segmentId ? null : currentSegmentId));
    }
  }

  async function generateFullScore() {
    if (!project) {
      return;
    }

    if (hasSavedRoiSegments && hasUnsavedRoiChanges) {
      setStatusMessage("ROI 변경사항을 먼저 저장한 뒤 전체 Tab를 생성해 주세요.");
      return;
    }

    if (!hasSavedRoiSegments && !roi) {
      return;
    }

    if (roi) {
      setSelection(toRawSelection(roi));
    }

    setIsAssembling(true);
    setStatusMessage(null);

    try {
      const requestBody = hasSavedRoiSegments
        ? {}
        : {
            roi,
            selectionMode
          };
      const response = await fetch(`/api/projects/${project.id}/assemble`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      const payload = (await response.json().catch(() => null)) as
        | { project?: DraftProject; error?: string }
        | null;

      if (!response.ok) {
        if (payload?.project) {
          onProjectUpdated(payload.project);
        }

        throw new Error(payload?.error ?? "Failed to assemble the full tab score.");
      }

      if (!payload?.project) {
        throw new Error(payload?.error ?? "Failed to assemble the full tab score.");
      }

      onProjectUpdated(payload.project);
      onRequestWorkspaceMode("edit");
      setStatusMessage("영상 전체 tab를 하나의 악보로 완성했습니다. 필요하면 악보 수정 탭에서 조각을 추가/삭제하세요.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to assemble the full tab score."
      );
    } finally {
      setIsAssembling(false);
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

  function jumpToRoiSegment(segment: SavedRoiSegment) {
    const targetFrame = findClosestFrameForSegment(frames, segment);

    if (!targetFrame) {
      return;
    }

    setSelectedFrameId(targetFrame.id);
  }

  function activateGapEdit(gapKey: string) {
    setActiveScoreCropIndex(null);
    setActiveGapKey(gapKey);
  }

  function activateScoreCrop(cropIndex: number) {
    setActiveGapKey(null);
    setActiveScoreCropIndex((currentCropIndex) => (currentCropIndex === cropIndex ? null : cropIndex));
  }

  function switchViewerMode(nextMode: ViewerMode) {
    setViewerMode(nextMode);

    if (nextMode === "scroll") {
      setViewerPageStartIndex(0);
      return;
    }

    setViewerAutoScrollEnabled(false);
    setViewerPageStartIndex(0);
  }

  function adjustViewerScrollZoom(delta: number) {
    setViewerScrollZoomPercent((currentZoom) =>
      clampNumber(currentZoom + delta, VIEWER_SCROLL_ZOOM_MIN, VIEWER_SCROLL_ZOOM_MAX)
    );
  }

  function handleViewerBodyPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isViewerToolbarHidden || viewerMode !== "scroll") {
      return;
    }

    viewerTapGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
  }

  function handleViewerBodyPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isViewerToolbarHidden || viewerMode !== "scroll") {
      return;
    }

    if (viewerTapGestureRef.current.pointerId !== event.pointerId) {
      return;
    }

    if (
      Math.abs(event.clientX - viewerTapGestureRef.current.startX) > 8 ||
      Math.abs(event.clientY - viewerTapGestureRef.current.startY) > 8
    ) {
      viewerTapGestureRef.current.moved = true;
    }
  }

  function handleViewerBodyPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isViewerToolbarHidden || viewerMode !== "scroll") {
      return;
    }

    if (viewerTapGestureRef.current.pointerId !== event.pointerId) {
      return;
    }

    const shouldToggleAutoScroll = !viewerTapGestureRef.current.moved;

    viewerTapGestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      moved: false
    };

    if (shouldToggleAutoScroll) {
      setViewerAutoScrollEnabled((currentValue) => !currentValue);
    }
  }

  function handleViewerBodyPointerCancel() {
    viewerTapGestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      moved: false
    };
  }

  function goToPreviousViewerPages() {
    setViewerPageStartIndex((currentPageStartIndex) =>
      Math.max(0, currentPageStartIndex - viewerPageSpread)
    );
  }

  function goToNextViewerPages() {
    setViewerPageStartIndex((currentPageStartIndex) =>
      Math.min(Math.max(0, viewerPageCount - 1), currentPageStartIndex + viewerPageSpread)
    );
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
    ? `${project.assembledScore.sourceFrameCount} -> ${project.assembledScore.stitchedFrameCount}`
    : frames.length > 0
      ? `${frames.length} frames`
      : isCapturing
      ? "capturing"
        : "ready";
  const activeRoiSegmentIndex = activeRoiSegment
    ? roiSegments.findIndex((segment) => segment.id === activeRoiSegment.id)
    : -1;
  const activeRoiSegmentEnd = activeRoiSegmentIndex >= 0 ? roiSegments[activeRoiSegmentIndex + 1] ?? null : null;
  const canInsertRoiFromCurrent = Boolean(
    roi &&
      selectedFrame &&
      hasSavedRoiSegments &&
      selectedFrame.timestampSec > (activeRoiSegment?.startTimestampSec ?? -1) &&
      !roiSegments.some((segment) => segment.startTimestampSec === selectedFrame.timestampSec)
  );
  const roiTimelineStatusText = activeRoiSegment
    ? `${formatSeconds(activeRoiSegment.startTimestampSec)}부터 ${
        activeRoiSegmentEnd ? formatSeconds(activeRoiSegmentEnd.startTimestampSec) : "끝"
      }까지 적용`
    : hasSavedRoiSegments
      ? "선택한 프레임에 맞는 ROI 구간을 찾지 못했습니다."
      : "아직 저장된 ROI 구간이 없습니다.";

  return (
    <section className="minimal-card stack-sm">
      {isConvertMode ? (
        <>
          <div className="workspace-subheader">
            <div className="workspace-subheader-main">
              <h2 className="section-title">유튜브 변환</h2>
            </div>
            <div className="workspace-subheader-meta">
              <p className="section-summary-chip">{summaryText}</p>
            </div>
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
                    isUsed={usedFrameIdSet.has(frame.id)}
                    isError={failedAssemblyFrameIdSet.has(frame.id)}
                    imageUrl={projectAssetUrl(project.id, frame.relativePath)}
                    onSelect={() => setSelectedFrameId(frame.id)}
                  />
                ))
              )}
            </div>

            {project.assemblyFailure?.failedFrameIds.length ? (
              <p className="error-text">
                선택한 ROI에서 tab를 찾지 못한 프레임 {project.assemblyFailure.failedFrameIds.length}개를 빨간색으로 표시했습니다.
              </p>
            ) : null}
          </div>

          <div className="section-block stack-xs">
            <div className="action-row">
              <button className="ghost-button" type="button" onClick={suggestBottomBand} disabled={!imageElement}>
                자동 선택
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={clearSelection}
                disabled={!selection && !activeRoiSegment}
              >
                {activeRoiSegment ? "저장 ROI로 되돌리기" : "ROI 지우기"}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void saveRoiSegment("replace-active")}
                disabled={!roi || isSavingRoi}
              >
                {isSavingRoi
                  ? "저장 중"
                  : hasSavedRoiSegments
                    ? "현재 구간 ROI 저장"
                    : "처음부터 ROI 저장"}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void saveRoiSegment("insert-from-current")}
                disabled={!canInsertRoiFromCurrent || isSavingRoi}
              >
                현재 프레임부터 새 ROI
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void generateFullScore()}
                disabled={!canGenerateFullScore || isAssembling || isApplyingManualEdit}
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

          <div className="section-block stack-xs">
            <div className="row-between">
              <div className="stack-xs">
                <p className="section-label">ROI Timeline</p>
                <p className="muted">
                  {selectedFrame ? `${formatSeconds(selectedFrame.timestampSec)} 프레임 기준 · ` : ""}
                  {roiTimelineStatusText}
                </p>
              </div>
              <p className="muted">구간 {roiSegments.length}</p>
            </div>

            {hasUnsavedRoiChanges ? (
              <div className="status-box">현재 ROI 변경사항이 저장되지 않았습니다. 저장 후 전체 Tab를 생성하세요.</div>
            ) : null}

            {roiSegments.length > 0 ? (
              <div className="roi-segment-list">
                {roiSegments.map((segment, index) => {
                  const nextSegment = roiSegments[index + 1] ?? null;
                  const isActiveSegment = segment.id === activeRoiSegment?.id;

                  return (
                    <article
                      className={isActiveSegment ? "roi-segment-card is-active" : "roi-segment-card"}
                      key={segment.id}
                    >
                      <div className="roi-segment-main stack-xs">
                        <div className="row-between">
                          <p className="section-label">
                            {formatSeconds(segment.startTimestampSec)}부터
                            {" · "}
                            {nextSegment ? formatSeconds(nextSegment.startTimestampSec) : "끝"}
                          </p>
                          <p className="muted">{isActiveSegment ? "현재 적용중" : ""}</p>
                        </div>
                        <p className="muted">
                          {formatRoiSelectionModeLabel(segment.selectionMode)}
                          {segment.startFrameId ? ` · ${segment.startFrameId}` : ""}
                        </p>
                      </div>
                      <div className="action-row">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => jumpToRoiSegment(segment)}
                        >
                          이 시점 보기
                        </button>
                        {index > 0 ? (
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() => void deleteRoiSegment(segment.id)}
                            disabled={deletingRoiSegmentId === segment.id}
                          >
                            {deletingRoiSegmentId === segment.id ? "삭제 중" : "구간 삭제"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-box">
                첫 ROI를 저장하면 그 구간이 영상 시작부터 적용됩니다. 이후 다른 프레임에서 `현재 프레임부터 새 ROI`를 누르면 그 시점부터 새로운 ROI가 이어집니다.
              </div>
            )}
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
                      <span className="button-with-icon">
                        <Pencil className="button-icon" aria-hidden="true" />
                        <span className="button-label">악보 수정 탭</span>
                      </span>
                    </button>
                    <button className="ghost-button" type="button" onClick={() => setIsScoreViewerOpen(true)}>
                      <span className="button-with-icon">
                        <Expand className="button-icon" aria-hidden="true" />
                        <span className="button-label">크게 보기</span>
                      </span>
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void downloadScoreImage()}
                      disabled={isDownloadingScore || isExportLocked}
                    >
                      <span className="button-with-icon">
                        <Download className="button-icon" aria-hidden="true" />
                        <span className="button-label">{isDownloadingScore ? "PNG 생성 중" : "PNG"}</span>
                      </span>
                    </button>
                  </div>
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
          <div className="workspace-subheader editor-subheader">
            <div className="workspace-subheader-main editor-subheader-main stack-xs">
              <p className="editor-kicker">Score Editor</p>
              <h2 className="section-title">악보 수정</h2>
              <p className="muted editor-subheader-copy">전체 악보를 보면서 조각 추가, 삭제, 출력 설정을 정리합니다.</p>
            </div>
            <div className="workspace-subheader-meta editor-subheader-meta">
              <div className="section-summary-chip editor-summary-chip">
                <span className="editor-summary-label">요약</span>
                <span className="editor-summary-value">{summaryText}</span>
              </div>
              <button className="ghost-button" type="button" onClick={() => onRequestWorkspaceMode("convert")}>
                <span className="button-with-icon">
                  <Film className="button-icon" aria-hidden="true" />
                  <span className="button-label">변환 보기</span>
                </span>
              </button>
            </div>
          </div>

          {project.assembledScore && assembledScoreUrl ? (
            <div className="section-block editor-panel-shell stack-sm">
              <div className="editor-panel-header">
                <div className="editor-panel-title">
                  <div className="editor-panel-icon">
                    <BookOpen className="button-icon" aria-hidden="true" />
                  </div>
                  <div className="stack-xs">
                    <p className="section-label">전체 Tab</p>
                    <p className="editor-panel-meta">
                      {project.assembledScore.sourceFrameCount}
                      {" -> "}
                      {project.assembledScore.stitchedFrameCount}
                      {manualInsertedCount > 0 ? ` / 수동 추가 ${manualInsertedCount}` : ""}
                    </p>
                  </div>
                </div>

                <div className="editor-toolbar">
                  <div className="editor-toolbar-section">
                    <p className="editor-toolbar-label">보기 배경</p>
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
                  </div>
                  <div className="editor-toolbar-section">
                    <p className="editor-toolbar-label">표시 방식</p>
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
                  </div>
                  <div className="editor-toolbar-section is-actions">
                    <p className="editor-toolbar-label">출력</p>
                    <div className="editor-toolbar-actions">
                      <button className="ghost-button" type="button" onClick={() => setIsScoreViewerOpen(true)}>
                        <span className="button-with-icon">
                          <Expand className="button-icon" aria-hidden="true" />
                          <span className="button-label">크게 보기</span>
                        </span>
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void downloadScoreImage()}
                        disabled={isDownloadingScore || isExportLocked}
                      >
                        <span className="button-with-icon">
                          <Download className="button-icon" aria-hidden="true" />
                          <span className="button-label">{isDownloadingScore ? "PNG 생성 중" : "PNG"}</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className={editorScoreShellClassName}>
                <div className="score-editor-canvas">
                  <img className={assembledImageClassName} src={assembledScoreUrl} alt="Assembled guitar tab score" />
                  <div className="score-editor-overlay">
                    {scoreOverlayLayout.segments.map((region) => (
                      <div
                        key={`segment-${region.cropIndex}`}
                        className={
                          activeScoreCropIndex === region.cropIndex
                            ? "score-region-shell is-active"
                            : "score-region-shell"
                        }
                        style={{
                          top: `${region.topPercent}%`,
                          height: `${region.heightPercent}%`,
                          left: `${region.leftPercent}%`,
                          width: `${region.widthPercent}%`
                        }}
                      >
                        <button
                          className="score-region-hitbox"
                          type="button"
                          onClick={() => activateScoreCrop(region.cropIndex)}
                          aria-label={`${formatSeconds(region.timestampSec)} 조각 선택`}
                        >
                          <span className="score-region-label">{formatSeconds(region.timestampSec)}</span>
                        </button>
                        <button
                          className="score-region-delete"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void removeCropFromSequence(region.cropIndex);
                          }}
                          aria-label={`${formatSeconds(region.timestampSec)} 조각 삭제`}
                          title="조각 삭제"
                          disabled={isApplyingManualEdit || !canRemoveSequenceCrop}
                        >
                          <X className="button-icon" aria-hidden="true" />
                        </button>
                      </div>
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
                </div>
              </div>

              <p className="muted">조각 클릭: 제거 후보 선택 / `+` 클릭: 이 위치에 추가할 후보 열기</p>

            </div>
          ) : (
            <div className="empty-box">유튜브 변환 탭에서 먼저 전체 Tab를 생성하세요.</div>
          )}

          {statusMessage ? <div className="status-box">{statusMessage}</div> : null}
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
            {isViewerToolbarHidden ? (
              <>
                <div className="viewer-floating-actions">
                  <button
                    className="ghost-button icon-button"
                    type="button"
                    onClick={() => setIsViewerToolbarHidden(false)}
                    aria-label="설정 보기"
                    title="설정 보기"
                  >
                    <Eye className="button-icon" aria-hidden="true" />
                  </button>
                  <button
                    className="ghost-button icon-button"
                    type="button"
                    onClick={() => setIsScoreViewerOpen(false)}
                    aria-label="닫기"
                    title="닫기"
                  >
                    <X className="button-icon" aria-hidden="true" />
                  </button>
                </div>

                {viewerMode === "scroll" ? (
                  <div className="viewer-floating-scroll-controls">
                    <button
                      className={viewerAutoScrollEnabled ? "primary-button viewer-gesture-toggle" : "ghost-button viewer-gesture-toggle"}
                      type="button"
                      onClick={() => setViewerAutoScrollEnabled((currentValue) => !currentValue)}
                    >
                      <span className="viewer-gesture-label">
                        화면 탭
                        {" · "}
                        {viewerAutoScrollEnabled ? "정지" : "시작"}
                      </span>
                      <span className="viewer-gesture-value">{formatViewerScrollSpeed(viewerAutoScrollSpeed)}</span>
                    </button>
                    <div className="viewer-floating-speed">
                      <ViewerSpeedSlider
                        ariaLabel="자동 스크롤 속도"
                        value={viewerAutoScrollSpeed}
                        min={VIEWER_AUTO_SCROLL_MIN}
                        max={VIEWER_AUTO_SCROLL_MAX}
                        step={VIEWER_AUTO_SCROLL_STEP}
                        onChange={setViewerAutoScrollSpeed}
                        variant="compact"
                      />
                    </div>
                    <div className="viewer-floating-zoom">
                      <button
                        className="ghost-button icon-button"
                        type="button"
                        onClick={() => adjustViewerScrollZoom(-VIEWER_SCROLL_ZOOM_STEP)}
                        disabled={viewerScrollZoomPercent <= VIEWER_SCROLL_ZOOM_MIN}
                        aria-label="화면 축소"
                        title="화면 축소"
                      >
                        <Minus className="button-icon" aria-hidden="true" />
                      </button>
                      <span className="viewer-floating-zoom-value">{viewerScrollZoomPercent}%</span>
                      <button
                        className="ghost-button icon-button"
                        type="button"
                        onClick={() => adjustViewerScrollZoom(VIEWER_SCROLL_ZOOM_STEP)}
                        disabled={viewerScrollZoomPercent >= VIEWER_SCROLL_ZOOM_MAX}
                        aria-label="화면 확대"
                        title="화면 확대"
                      >
                        <Plus className="button-icon" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="viewer-toolbar">
                <div className="viewer-toolbar-top">
                  <div className="viewer-toolbar-brand">
                    <div className="viewer-toolbar-copy stack-xs">
                      <p className="viewer-toolbar-kicker">Score Viewer</p>
                      <div className="viewer-toolbar-title-line">
                        <p className="section-label">Fullscreen Tab</p>
                        <p className="viewer-toolbar-status">{viewerStatusLabel}</p>
                      </div>
                    </div>
                  </div>

                  <div className="viewer-toolbar-actions">
                    <button
                      className="ghost-button icon-button"
                      type="button"
                      onClick={() => setIsViewerToolbarHidden(true)}
                      aria-label="설정 숨기기"
                      title="설정 숨기기"
                    >
                      <EyeOff className="button-icon" aria-hidden="true" />
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void downloadScoreImage()}
                      disabled={isDownloadingScore || isExportLocked}
                    >
                      <span className="button-with-icon">
                        <Download className="button-icon" aria-hidden="true" />
                        <span className="button-label">{isDownloadingScore ? "PNG 생성 중" : "PNG"}</span>
                      </span>
                    </button>
                    <button
                      className="ghost-button icon-button"
                      type="button"
                      onClick={() => setIsScoreViewerOpen(false)}
                      aria-label="닫기"
                      title="닫기"
                    >
                      <X className="button-icon" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="viewer-toolbar-strip">
                  <div className="viewer-toolbar-inline-group is-mode" role="group" aria-label="Viewer mode">
                    <span className="viewer-inline-label">보기 방식</span>
                    <div className="toggle-group">
                      <button
                        className={viewerMode === "scroll" ? "toggle-button is-active" : "toggle-button"}
                        type="button"
                        onClick={() => switchViewerMode("scroll")}
                      >
                        <span className="button-with-icon">
                          <ScrollText className="button-icon" aria-hidden="true" />
                          <span className="button-label">스크롤</span>
                        </span>
                      </button>
                      <button
                        className={viewerMode === "page" ? "toggle-button is-active" : "toggle-button"}
                        type="button"
                        onClick={() => switchViewerMode("page")}
                      >
                        <span className="button-with-icon">
                          <BookOpen className="button-icon" aria-hidden="true" />
                          <span className="button-label">페이지</span>
                        </span>
                      </button>
                    </div>
                  </div>

                  {viewerMode === "scroll" ? (
                    <>
                      <div className="viewer-toolbar-inline-group is-zoom">
                        <span className="viewer-inline-label">확대</span>
                        <button
                          className="ghost-button icon-button"
                          type="button"
                          onClick={() => adjustViewerScrollZoom(-VIEWER_SCROLL_ZOOM_STEP)}
                          disabled={viewerScrollZoomPercent <= VIEWER_SCROLL_ZOOM_MIN}
                          aria-label="축소"
                          title="축소"
                        >
                          <Minus className="button-icon" aria-hidden="true" />
                        </button>
                        <p className="viewer-control-value">{viewerScrollZoomPercent}%</p>
                        <button
                          className="ghost-button icon-button"
                          type="button"
                          onClick={() => adjustViewerScrollZoom(VIEWER_SCROLL_ZOOM_STEP)}
                          disabled={viewerScrollZoomPercent >= VIEWER_SCROLL_ZOOM_MAX}
                          aria-label="확대"
                          title="확대"
                        >
                          <Plus className="button-icon" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="viewer-toolbar-inline-group is-grow is-playback">
                        <div className="viewer-inline-stack">
                          <span className="viewer-inline-label">자동 스크롤</span>
                          <button
                            className={viewerAutoScrollEnabled ? "primary-button" : "ghost-button"}
                            type="button"
                            onClick={() => setViewerAutoScrollEnabled((currentValue) => !currentValue)}
                          >
                            <span className="button-with-icon">
                              {viewerAutoScrollEnabled ? (
                                <Pause className="button-icon" aria-hidden="true" />
                              ) : (
                                <Play className="button-icon" aria-hidden="true" />
                              )}
                              <span className="button-label">{viewerAutoScrollEnabled ? "정지" : "시작"}</span>
                            </span>
                          </button>
                        </div>
                        <div className="viewer-speed-block">
                          <label className="viewer-slider-wrap is-inline">
                            <span className="viewer-inline-label">속도</span>
                            <ViewerSpeedSlider
                              ariaLabel="자동 스크롤 속도"
                              value={viewerAutoScrollSpeed}
                              min={VIEWER_AUTO_SCROLL_MIN}
                              max={VIEWER_AUTO_SCROLL_MAX}
                              step={VIEWER_AUTO_SCROLL_STEP}
                              onChange={setViewerAutoScrollSpeed}
                            />
                          </label>
                          <p className="viewer-control-value">{formatViewerScrollSpeed(viewerAutoScrollSpeed)}</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="viewer-toolbar-inline-group is-page" role="group" aria-label="Page spread">
                        <span className="viewer-inline-label">페이지 보기</span>
                        <div className="toggle-group">
                          <button
                            className={viewerPageSpread === 1 ? "toggle-button is-active" : "toggle-button"}
                            type="button"
                            onClick={() => setViewerPageSpread(1)}
                          >
                            <span className="button-with-icon">
                              <BookOpen className="button-icon" aria-hidden="true" />
                              <span className="button-label">1페이지</span>
                            </span>
                          </button>
                          <button
                            className={viewerPageSpread === 2 ? "toggle-button is-active" : "toggle-button"}
                            type="button"
                            onClick={() => setViewerPageSpread(2)}
                            disabled={viewerPageCount < 2}
                          >
                            <span className="button-with-icon">
                              <BookOpen className="button-icon" aria-hidden="true" />
                              <span className="button-label">2페이지</span>
                            </span>
                          </button>
                        </div>
                      </div>
                      <div className="viewer-toolbar-inline-group is-nav">
                        <span className="viewer-inline-label">페이지 이동</span>
                        <button
                          className="ghost-button icon-button"
                          type="button"
                          onClick={goToPreviousViewerPages}
                          disabled={!canViewerGoPrevious}
                          aria-label="이전 페이지"
                          title="이전 페이지"
                        >
                          <ChevronLeft className="button-icon" aria-hidden="true" />
                        </button>
                        <p className="viewer-control-value">{viewerPageRangeLabel}</p>
                        <button
                          className="ghost-button icon-button"
                          type="button"
                          onClick={goToNextViewerPages}
                          disabled={!canViewerGoNext}
                          aria-label="다음 페이지"
                          title="다음 페이지"
                        >
                          <ChevronRight className="button-icon" aria-hidden="true" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            <div
              ref={viewerBodyRef}
              className={
                previewBackground === "dark"
                  ? viewerMode === "page"
                    ? "viewer-body is-dark is-page-mode"
                    : viewerScrollZoomPercent > 100
                      ? "viewer-body is-dark is-scroll-zoomed"
                      : "viewer-body is-dark"
                  : viewerMode === "page"
                    ? "viewer-body is-light is-page-mode"
                    : viewerScrollZoomPercent > 100
                      ? "viewer-body is-light is-scroll-zoomed"
                      : "viewer-body is-light"
              }
              onPointerDown={handleViewerBodyPointerDown}
              onPointerMove={handleViewerBodyPointerMove}
              onPointerUp={handleViewerBodyPointerUp}
              onPointerCancel={handleViewerBodyPointerCancel}
            >
              {viewerMode === "scroll" ? (
                <div
                  className={viewerScrollZoomPercent > 100 ? "viewer-image-shell is-zoomed" : "viewer-image-shell"}
                  style={{
                    width: `${viewerScrollZoomPercent}%`
                  }}
                >
                  <img className={viewerImageClassName} src={assembledScoreUrl} alt="Full assembled guitar tab score" />
                </div>
              ) : viewerVisiblePageIndices.length > 0 && viewerPageWidth > 0 && viewerPageHeight > 0 ? (
                <div className={viewerPageSpread === 2 ? "viewer-page-stage is-two-page" : "viewer-page-stage"}>
                  {viewerVisiblePageIndices.map((pageIndex) => (
                    <div
                      className="viewer-page-shell"
                      key={pageIndex}
                      style={{
                        width: `${viewerPageWidth}px`
                      }}
                    >
                      <div
                        className="viewer-page-frame"
                        style={{
                          height: `${viewerPageHeight}px`
                        }}
                      >
                        <img
                          className={`${viewerImageClassName} viewer-page-image`}
                          src={assembledScoreUrl}
                          alt={`Full assembled guitar tab score page ${pageIndex + 1}`}
                          style={{
                            top: `-${pageIndex * viewerPageHeight}px`
                          }}
                        />
                        <p className="viewer-page-label">
                          페이지 {pageIndex + 1}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-box">페이지를 준비하는 중입니다.</div>
              )}
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

      {activeGap ? (
        <div
          className="score-popup-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="추가할 조각 선택"
          onClick={() => {
            if (activeGapPreviewItem) {
              setActiveGapPreviewTarget(null);
              return;
            }

            setActiveGapKey(null);
          }}
        >
          <div
            className={activeGapPreviewItem ? "score-gap-popup is-preview-mode" : "score-gap-popup"}
            onClick={(event) => event.stopPropagation()}
          >
            {activeGapPreviewItem ? (
              <div className="gap-preview-stage stack-sm">
                <div className="row-between">
                  <div className="stack-xs">
                    <p className="section-label">
                      {activeGapPreviewTarget?.kind === "candidate"
                        ? "선택한 조각"
                        : activeGapPreviewTarget?.kind === "previous"
                          ? "이전 기준 조각"
                          : "다음 기준 조각"}
                    </p>
                    <p className="muted">{formatSeconds(activeGapPreviewItem.timestampSec)}</p>
                  </div>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setActiveGapPreviewTarget(null)}
                  >
                    최소
                  </button>
                </div>
                <div className={reviewFrameShellClassName}>
                  <img
                    className={reviewImageClassName}
                    src={projectAssetUrl(project.id, activeGapPreviewItem.relativePath)}
                    alt="Expanded gap preview segment"
                  />
                </div>
                <div className="action-row">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setActiveGapPreviewTarget(null)}
                  >
                    목록으로
                  </button>
                  {activeGapPreviewTarget?.kind === "candidate" ? (
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() =>
                        void insertCropIntoGap(activeGap, activeGapPreviewTarget.cropIndex)
                      }
                      disabled={isApplyingManualEdit}
                    >
                      이 조각 추가
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div className="row-between">
                  <div className="stack-xs">
                    <p className="section-label">추가할 조각 선택</p>
                    <p className="muted">
                      {activeGap.previous ? formatSeconds(activeGap.previous.timestampSec) : "시작"} ~{" "}
                      {activeGap.next ? formatSeconds(activeGap.next.timestampSec) : "끝"} 사이에 캡처된 1초 crop만 보여줍니다.
                    </p>
                    <p className="muted">후보 {activeGapCandidateCrops.length}개</p>
                  </div>
                  <button className="ghost-button" type="button" onClick={() => setActiveGapKey(null)}>
                    닫기
                  </button>
                </div>

              <div className="review-preview-grid">
                {activeGap.previous ? (
                  <button
                    className="boundary-preview-button"
                    type="button"
                    onClick={() => setActiveGapPreviewTarget({ kind: "previous" })}
                  >
                    <div className={`${reviewFrameShellClassName} boundary-frame-shell is-start`}>
                      <p className="review-frame-label">
                        이전 {formatSeconds(activeGap.previous.timestampSec)}
                      </p>
                      <img
                        className={reviewImageClassName}
                        src={projectAssetUrl(project.id, activeGap.previous.relativePath)}
                        alt="Previous score segment"
                      />
                    </div>
                  </button>
                ) : (
                  <div className={`${reviewFrameShellClassName} boundary-frame-shell is-start`}>
                    <p className="review-frame-label">시작</p>
                    <p className="preview-empty">악보 시작 지점</p>
                  </div>
                )}
                {activeGap.next ? (
                  <button
                    className="boundary-preview-button"
                    type="button"
                    onClick={() => setActiveGapPreviewTarget({ kind: "next" })}
                  >
                    <div className={`${reviewFrameShellClassName} boundary-frame-shell is-end`}>
                      <p className="review-frame-label">다음 {formatSeconds(activeGap.next.timestampSec)}</p>
                      <img
                        className={reviewImageClassName}
                        src={projectAssetUrl(project.id, activeGap.next.relativePath)}
                        alt="Next score segment"
                      />
                    </div>
                  </button>
                ) : (
                  <div className={`${reviewFrameShellClassName} boundary-frame-shell is-end`}>
                    <p className="review-frame-label">끝</p>
                    <p className="preview-empty">악보 마지막 뒤</p>
                  </div>
                )}
              </div>

              {activeGapCandidateCrops.length > 0 ? (
                <>
                  <div className="empty-box">
                    기준 조각이나 후보 조각을 클릭하면 크게 볼 수 있습니다. 후보 조각만 확대 후 `추가`가 가능합니다.
                  </div>

                  <div className="gap-popup-grid">
                    {activeGapCandidateCrops.map((crop) => {
                      const isActivePreview =
                        activeGapPreviewTarget?.kind === "candidate" &&
                        activeGapPreviewTarget.cropIndex === crop.cropIndex;

                      return (
                        <article
                          className={
                            isActivePreview
                              ? "candidate-card stack-xs candidate-card-large is-active"
                              : "candidate-card stack-xs candidate-card-large"
                          }
                          key={crop.cropIndex}
                        >
                          <button
                            className="candidate-preview-button"
                            type="button"
                            onClick={() =>
                              setActiveGapPreviewTarget((currentTarget) =>
                                currentTarget?.kind === "candidate" &&
                                currentTarget.cropIndex === crop.cropIndex
                                  ? null
                                  : { kind: "candidate", cropIndex: crop.cropIndex }
                              )
                            }
                            aria-label={`${formatSeconds(crop.timestampSec)} 조각 확대 보기`}
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
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="empty-box">
                  전/후 프레임 사이에 추가 가능한 1초 crop가 없습니다. 다른 위치를 선택하거나 원본 프레임을 확인해 주세요.
                </div>
              )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FrameThumbnail({
  frame,
  isSelected,
  isUsed,
  isError,
  imageUrl,
  onSelect
}: {
  frame: ProjectFrameAsset;
  isSelected: boolean;
  isUsed: boolean;
  isError: boolean;
  imageUrl: string;
  onSelect: () => void;
}) {
  const className = [
    "thumbnail-card",
    isUsed ? "is-used" : "",
    isError ? "is-error" : "",
    isSelected ? "is-selected" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={className} type="button" onClick={onSelect}>
      <img className="thumbnail-image" src={imageUrl} alt={`Frame at ${formatSeconds(frame.timestampSec)}`} />
      <span className="thumbnail-time">{formatSeconds(frame.timestampSec)}</span>
    </button>
  );
}
