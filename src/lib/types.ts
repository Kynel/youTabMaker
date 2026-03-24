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

export interface SavedRoi {
  selection: RoiSelection;
  selectionMode: "manual" | "bottom-band-suggestion";
  savedAt: string;
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
  sourceUrl: string;
  normalizedUrl: string;
  recommendedMode: ProcessingMode;
  warnings: string[];
  pipeline: PipelineStep[];
  runtime: RuntimeInspection;
  videoAsset?: VideoAsset;
  frames?: ProjectFrameAsset[];
  assembledScore?: AssembledScoreAsset;
  sourceFrame?: SourceFrameAsset;
  roi?: SavedRoi;
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
