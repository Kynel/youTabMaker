export type ProcessingMode = "youtube-url" | "image-upload";
export type ProjectProcessingKind = "capture" | "assemble";

export interface DependencyStatus {
  id: string;
  label: string;
  purpose: string;
  available: boolean;
}

export interface SourceFrameAsset {
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  bytes: number;
  uploadedAt: string;
  relativePath: string;
  width?: number;
  height?: number;
}

export interface VideoAsset {
  relativePath: string;
  downloadedAt: string;
  durationSeconds?: number;
}

export interface ProjectFrameAsset {
  id: string;
  timestampSec: number;
  relativePath: string;
  width: number;
  height: number;
}

export interface AssembledScoreAsset {
  relativePath: string;
  metadataPath: string;
  generatedAt: string;
  width: number;
  height: number;
  sourceFrameCount: number;
  stitchedFrameCount: number;
}

export type AssemblyTrimMode = "initial" | "auto" | "review" | "keep" | "manual";

export interface AssemblyCropAsset {
  cropIndex: number;
  frameId: string;
  timestampSec: number;
  relativePath: string;
  width: number;
  height: number;
}

export interface AssemblySequenceItem extends AssemblyCropAsset {
  trimMode: AssemblyTrimMode;
  overlapTrimTopPx: number;
  overlapScore: number | null;
  gapBefore: number;
  transitionId?: string;
}

export type AssemblyReviewDecision = "keep_both" | "trim_overlap";

export interface AssemblyReviewItem {
  id: string;
  previousFrameId: string;
  previousTimestampSec: number;
  previousCropRelativePath: string;
  currentFrameId: string;
  currentTimestampSec: number;
  currentCropRelativePath: string;
  overlapScore: number;
  overlapTrimCandidatePx: number;
  overlapTrimRatio: number;
  reason: string;
  recommendedDecision: AssemblyReviewDecision;
  decision?: AssemblyReviewDecision;
}

export interface AssemblyReviewState {
  generatedAt: string;
  totalCount: number;
  pendingCount: number;
  items: AssemblyReviewItem[];
}

export interface AssemblyManualEditState {
  updatedAt: string;
  orderedCropIndices: number[];
  forcedCropIndices: number[];
}

export interface AssemblyEditorState {
  generatedAt: string;
  cropCount: number;
  orderedCropIndices: number[];
  forcedCropIndices: number[];
  crops: AssemblyCropAsset[];
  sequence: AssemblySequenceItem[];
}

export interface SavedRoi {
  selection: RoiSelection;
  selectionMode: "manual" | "bottom-band-suggestion";
  savedAt: string;
}

export interface SavedRoiSegment extends SavedRoi {
  id: string;
  startTimestampSec: number;
  startFrameId: string | null;
}

export interface SavedRoiTimeline {
  updatedAt: string;
  segments: SavedRoiSegment[];
}

export interface AssemblyFailureState {
  generatedAt: string;
  reason: string;
  failedFrameIds: string[];
}

export interface SavedProjectSummary {
  id: string;
  title: string;
  sourceUrl: string;
  normalizedUrl: string;
  createdAt: string;
  updatedAt: string;
  frameCount: number;
  stitchedFrameCount: number;
  hasAssembledScore: boolean;
}

export interface RuntimeInspection {
  dependencies: DependencyStatus[];
  canProcessYoutubeUrl: boolean;
  canProcessImageUpload: boolean;
}

export interface PipelineStep {
  id: string;
  label: string;
  description: string;
  status: "ready" | "blocked" | "planned";
}

export interface ProjectProcessingStatus {
  kind: ProjectProcessingKind;
  stage: string;
  label: string;
  detail: string;
  progressPercent: number;
  startedAt: string;
  updatedAt: string;
  current?: number;
  total?: number;
  unit?: string;
}

export interface DraftProject {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  sourceUrl: string;
  normalizedUrl: string;
  recommendedMode: ProcessingMode;
  warnings: string[];
  pipeline: PipelineStep[];
  runtime: RuntimeInspection;
  videoAsset?: VideoAsset;
  frames?: ProjectFrameAsset[];
  assembledScore?: AssembledScoreAsset;
  assemblyEditor?: AssemblyEditorState;
  assemblyManualEdit?: AssemblyManualEditState;
  assemblyReview?: AssemblyReviewState;
  assemblyFailure?: AssemblyFailureState;
  sourceFrame?: SourceFrameAsset;
  roi?: SavedRoi;
  roiTimeline?: SavedRoiTimeline;
  processing?: ProjectProcessingStatus;
}

export interface RoiSelection {
  x: number;
  y: number;
  width: number;
  height: number;
  normalized: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
