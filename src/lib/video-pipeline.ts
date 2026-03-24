import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  ensureProjectSubdirectories,
  getProjectAssetAbsolutePath,
  getProjectDownloadsDirectory,
  getProjectFramesDirectory,
  getProjectOutputDirectory
} from "@/lib/storage";
import type {
  AssembledScoreAsset,
  AssemblyCropAsset,
  AssemblyEditorState,
  AssemblyManualEditState,
  AssemblyReviewDecision,
  AssemblyReviewItem,
  AssemblyReviewState,
  AssemblySequenceItem,
  AssemblyTrimMode,
  ProjectFrameAsset,
  RoiSelection,
  VideoAsset
} from "@/lib/types";

const MIN_TAB_DARK_RATIO = 0.02;
const RECENT_DUPLICATE_WINDOW = 6;
const DUPLICATE_HASH_DISTANCE = 12;
const NORMALIZATION_WIDTH_QUANTILE = 0.75;
const OVERLAP_ANALYSIS_WIDTH = 96;
const MIN_OVERLAP_RATIO = 0.12;
const MAX_OVERLAP_RATIO = 0.92;
const MIN_ACTIVE_OVERLAP_RATIO = 0.035;
const STRICT_OVERLAP_SCORE = 0.095;
const REVIEW_OVERLAP_SCORE = 0.28;
const SAFE_AUTO_OVERLAP_SCORE = 0.062;
const MAX_OVERLAP_TRIM_RATIO = 0.33;
const SAFE_AUTO_OVERLAP_TRIM_RATIO = 0.18;
const MIN_NEW_CONTENT_PX = 32;
const MIN_NEW_CONTENT_RATIO = 0.08;
const SHEET_PADDING = 18;
const PAGE_BREAK_GAP = 18;
const MAX_TRANSITION_LOOKAHEAD = 8;
const NORMALIZED_CROPS_DIRECTORY = path.posix.join("output", "normalized-crops");
const ASSEMBLY_MANIFEST_PATH = path.posix.join("output", "assembly-manifest.json");

interface PreparedCrop {
  frame: ProjectFrameAsset;
  buffer: Buffer;
  width: number;
  height: number;
  hash: string;
}

interface AnalysisImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface NormalizedCrop extends PreparedCrop {
  analysis: AnalysisImage;
  relativePath: string;
}

interface AppendedCrop {
  frame: ProjectFrameAsset;
  sourceRelativePath: string;
  width: number;
  height: number;
  appendBuffer: Buffer;
  appendHeight: number;
  overlapTrimTopPx: number;
  overlapScore: number | null;
  gapBefore: number;
  hash: string;
  trimMode: AssemblyTrimMode;
  cropIndex: number;
  transitionId?: string;
}

interface CropManifestEntry {
  index: number;
  frameId: string;
  timestampSec: number;
  relativePath: string;
  width: number;
  height: number;
  hash: string;
}

interface TransitionManifestEntry {
  id: string;
  previousCropIndex: number;
  currentCropIndex: number;
  overlapScore: number;
  overlapTrimCandidatePx: number;
  overlapTrimRatio: number;
  autoTrimApplied: boolean;
  recommendedDecision: AssemblyReviewDecision;
  reason: string;
}

interface AssemblyManifest {
  generatedAt: string;
  sourceFrameCount: number;
  normalizationWidth: number;
  roi: RoiSelection;
  crops: CropManifestEntry[];
  autoOrderedCropIndices?: number[];
  transitions: TransitionManifestEntry[];
}

interface AssembleProjectScoreResult {
  assembledScore: AssembledScoreAsset;
  assemblyEditor: AssemblyEditorState;
  assemblyReview: AssemblyReviewState;
}

interface RenderAssemblyOptions {
  orderedCropIndices?: number[];
  forcedCropIndices?: number[];
}

interface PipelineProgressUpdate {
  stage: string;
  label: string;
  detail: string;
  progressPercent: number;
  current?: number;
  total?: number;
  unit?: string;
}

interface ToolHooks {
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

type PipelineProgressReporter = (update: PipelineProgressUpdate) => Promise<void> | void;

function flushLines(buffer: string, emitLine?: (line: string) => void) {
  if (!emitLine) {
    return "";
  }

  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    emitLine(line);
  }

  return remainder;
}

function runTool(command: string, args: string[], cwd?: string, hooks?: ToolHooks) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let stdoutLineBuffer = "";
    let stderrLineBuffer = "";

    child.stdout.on("data", (chunk) => {
      const value = chunk.toString();
      stdout += value;
      stdoutLineBuffer = flushLines(stdoutLineBuffer + value, hooks?.onStdoutLine);
    });

    child.stderr.on("data", (chunk) => {
      const value = chunk.toString();
      stderr += value;
      stderrLineBuffer = flushLines(stderrLineBuffer + value, hooks?.onStderrLine);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (stdoutLineBuffer && hooks?.onStdoutLine) {
        hooks.onStdoutLine(stdoutLineBuffer);
      }

      if (stderrLineBuffer && hooks?.onStderrLine) {
        hooks.onStderrLine(stderrLineBuffer);
      }

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}\n${stderr}`));
    });
  });
}

async function getVideoDurationSeconds(absoluteVideoPath: string) {
  try {
    const { stdout } = await runTool("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      absoluteVideoPath
    ]);

    const durationSeconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(durationSeconds) ? durationSeconds : undefined;
  } catch {
    return undefined;
  }
}

function getLastNonEmptyLine(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}

export async function downloadProjectVideo(
  projectId: string,
  normalizedUrl: string,
  onProgress?: PipelineProgressReporter
): Promise<VideoAsset> {
  await ensureProjectSubdirectories(projectId);

  const downloadsDirectory = getProjectDownloadsDirectory(projectId);
  const outputTemplate = path.join(downloadsDirectory, "source.%(ext)s");

  const { stdout } = await runTool(
    "yt-dlp",
    [
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--progress-template",
      "download:%(progress._percent_str)s",
      "--format",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      "--print",
      "after_move:filepath",
      "--output",
      outputTemplate,
      normalizedUrl
    ],
    undefined,
    {
      onStdoutLine: (line) => {
        const match = line.match(/download:\s*([\d.]+)%/);

        if (!match) {
          return;
        }

        const percent = Number.parseFloat(match[1]);

        if (!Number.isFinite(percent) || !onProgress) {
          return;
        }

        void onProgress({
          stage: "downloading",
          label: "영상 다운로드 중",
          detail: "유튜브 영상을 가져오고 있습니다.",
          progressPercent: 8 + percent * 0.32
        });
      },
      onStderrLine: (line) => {
        const match = line.match(/download:\s*([\d.]+)%/);

        if (!match) {
          return;
        }

        const percent = Number.parseFloat(match[1]);

        if (!Number.isFinite(percent) || !onProgress) {
          return;
        }

        void onProgress({
          stage: "downloading",
          label: "영상 다운로드 중",
          detail: "유튜브 영상을 가져오고 있습니다.",
          progressPercent: 8 + percent * 0.32
        });
      }
    }
  );

  const absoluteVideoPath = getLastNonEmptyLine(stdout);

  if (!absoluteVideoPath) {
    throw new Error("yt-dlp did not return a downloaded file path.");
  }

  const durationSeconds = await getVideoDurationSeconds(absoluteVideoPath);

  return {
    relativePath: path.relative(path.join(process.cwd(), ".data", "projects", projectId), absoluteVideoPath),
    downloadedAt: new Date().toISOString(),
    durationSeconds
  };
}

export async function extractProjectFrames(
  projectId: string,
  videoAsset: VideoAsset,
  onProgress?: PipelineProgressReporter
): Promise<ProjectFrameAsset[]> {
  await ensureProjectSubdirectories(projectId);

  const absoluteVideoPath = getProjectAssetAbsolutePath(projectId, videoAsset.relativePath);
  const framesDirectory = getProjectFramesDirectory(projectId);
  const outputTemplate = path.join(framesDirectory, "frame-%05d.jpg");

  await runTool(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostats",
      "-y",
      "-i",
      absoluteVideoPath,
      "-vf",
      "fps=1",
      "-q:v",
      "2",
      "-start_number",
      "0",
      "-progress",
      "pipe:1",
      outputTemplate
    ],
    undefined,
    {
      onStdoutLine: (line) => {
        if (!onProgress || !videoAsset.durationSeconds) {
          return;
        }

        const match = line.match(/^out_time_(?:ms|us)=(\d+)$/);

        if (!match) {
          return;
        }

        const outTimeSeconds = Number.parseInt(match[1], 10) / 1_000_000;
        const percent = Math.min(1, outTimeSeconds / videoAsset.durationSeconds);

        void onProgress({
          stage: "extracting",
          label: "프레임 추출 중",
          detail: "1초 간격으로 전체 영상을 캡처하고 있습니다.",
          progressPercent: 42 + percent * 42
        });
      }
    }
  );

  const frameFiles = (await readdir(framesDirectory))
    .filter((fileName) => fileName.endsWith(".jpg"))
    .sort((left, right) => left.localeCompare(right));

  const frames = await Promise.all(
    frameFiles.map(async (fileName, index) => {
      const relativePath = path.posix.join("frames", fileName);
      const metadata = await sharp(getProjectAssetAbsolutePath(projectId, relativePath)).metadata();

      return {
        id: `frame-${index}`,
        timestampSec: index,
        relativePath,
        width: metadata.width ?? 0,
        height: metadata.height ?? 0
      } satisfies ProjectFrameAsset;
    })
  );

  return frames;
}

function hammingDistance(left: string, right: string) {
  const compareLength = Math.min(left.length, right.length);
  let distance = Math.abs(left.length - right.length);

  for (let index = 0; index < compareLength; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }

  return distance;
}

async function computeCropSignature(buffer: Buffer) {
  const { data } = await sharp(buffer)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(16, 16, {
      fit: "fill"
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  const hash = Array.from(data, (value) => (value >= average ? "1" : "0")).join("");
  const darkRatio = data.filter((value) => value < 220).length / data.length;

  return {
    hash,
    darkRatio
  };
}

function selectNormalizationWidth(widths: number[]) {
  const sortedWidths = [...widths].sort((left, right) => left - right);
  const index = Math.min(
    sortedWidths.length - 1,
    Math.max(0, Math.floor((sortedWidths.length - 1) * NORMALIZATION_WIDTH_QUANTILE))
  );

  return sortedWidths[index] ?? sortedWidths[0] ?? 1;
}

async function computeAnalysisImage(buffer: Buffer, width: number, height: number): Promise<AnalysisImage> {
  const analysisHeight = Math.max(24, Math.round((height / Math.max(1, width)) * OVERLAP_ANALYSIS_WIDTH));
  const { data, info } = await sharp(buffer)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(OVERLAP_ANALYSIS_WIDTH, analysisHeight, {
      fit: "fill"
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    pixels: new Uint8Array(data)
  };
}

function measureOverlapSimilarity(previous: AnalysisImage, current: AnalysisImage, overlapRows: number) {
  let weightedScore = 0;
  let totalWeight = 0;
  let activeSamples = 0;
  let sampleCount = 0;

  for (let row = 0; row < overlapRows; row += 2) {
    const previousRowOffset = (previous.height - overlapRows + row) * previous.width;
    const currentRowOffset = row * current.width;

    for (let column = 0; column < previous.width; column += 2) {
      const previousValue = previous.pixels[previousRowOffset + column] ?? 255;
      const currentValue = current.pixels[currentRowOffset + column] ?? 255;
      const active = previousValue < 230 || currentValue < 230;
      const weight = active ? 1.25 : 0.35;
      const mismatch =
        Math.abs(previousValue - currentValue) / 255 +
        Number((previousValue < 220) !== (currentValue < 220));

      weightedScore += mismatch * weight;
      totalWeight += 2 * weight;
      activeSamples += active ? 1 : 0;
      sampleCount += 1;
    }
  }

  if (totalWeight === 0 || sampleCount === 0) {
    return {
      score: 1,
      activeRatio: 0
    };
  }

  return {
    score: weightedScore / totalWeight,
    activeRatio: activeSamples / sampleCount
  };
}

function findVerticalOverlap(previous: AnalysisImage, current: AnalysisImage) {
  const maxOverlapRows = Math.floor(Math.min(previous.height, current.height) * MAX_OVERLAP_RATIO);
  const minOverlapRows = Math.max(10, Math.floor(Math.min(previous.height, current.height) * MIN_OVERLAP_RATIO));

  if (maxOverlapRows <= minOverlapRows) {
    return null;
  }

  let bestCandidate: { overlapRows: number; score: number } | null = null;

  for (let overlapRows = maxOverlapRows; overlapRows >= minOverlapRows; overlapRows -= 2) {
    const similarity = measureOverlapSimilarity(previous, current, overlapRows);

    if (similarity.activeRatio < MIN_ACTIVE_OVERLAP_RATIO) {
      continue;
    }

    if (similarity.score <= STRICT_OVERLAP_SCORE) {
      return {
        overlapRows,
        score: similarity.score
      };
    }

    if (!bestCandidate || similarity.score < bestCandidate.score) {
      bestCandidate = {
        overlapRows,
        score: similarity.score
      };
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  return null;
}

function buildTransitionId(previousCrop: CropManifestEntry, currentCrop: CropManifestEntry) {
  return `${previousCrop.index}-${currentCrop.index}-${previousCrop.frameId}-${currentCrop.frameId}`;
}

function formatRatioPercent(ratio: number) {
  return Math.max(0, Math.round(ratio * 100));
}

function buildReviewReason(overlapScore: number, overlapTrimRatio: number) {
  const trimPercent = formatRatioPercent(overlapTrimRatio);
  return `겹침 후보가 감지됐지만 자동 제거 확신도가 낮습니다. 예상 절삭 ${trimPercent}%, 유사도 ${overlapScore.toFixed(3)}.`;
}

function isSafeAutomaticTrim(overlapScore: number, overlapTrimRatio: number) {
  return overlapScore <= SAFE_AUTO_OVERLAP_SCORE && overlapTrimRatio <= SAFE_AUTO_OVERLAP_TRIM_RATIO;
}

function buildTransitionKey(previousCropIndex: number, currentCropIndex: number) {
  return `${previousCropIndex}:${currentCropIndex}`;
}

function buildAssemblyCropAsset(crop: CropManifestEntry): AssemblyCropAsset {
  return {
    cropIndex: crop.index,
    frameId: crop.frameId,
    timestampSec: crop.timestampSec,
    relativePath: crop.relativePath,
    width: crop.width,
    height: crop.height
  };
}

function buildAssemblyReviewState(
  manifest: AssemblyManifest,
  decisions: Partial<Record<string, AssemblyReviewDecision>>,
  orderedCropIndices: number[]
): AssemblyReviewState {
  const adjacentTransitionKeys = new Set(
    orderedCropIndices.slice(1).map((currentCropIndex, index) =>
      buildTransitionKey(orderedCropIndices[index] ?? -1, currentCropIndex)
    )
  );
  const items = manifest.transitions
    .filter(
      (transition) =>
        adjacentTransitionKeys.has(buildTransitionKey(transition.previousCropIndex, transition.currentCropIndex)) &&
        !transition.autoTrimApplied &&
        transition.overlapTrimCandidatePx > 0
    )
    .map((transition) => {
      const previousCrop = manifest.crops[transition.previousCropIndex];
      const currentCrop = manifest.crops[transition.currentCropIndex];

      return {
        id: transition.id,
        previousFrameId: previousCrop.frameId,
        previousTimestampSec: previousCrop.timestampSec,
        previousCropRelativePath: previousCrop.relativePath,
        currentFrameId: currentCrop.frameId,
        currentTimestampSec: currentCrop.timestampSec,
        currentCropRelativePath: currentCrop.relativePath,
        overlapScore: transition.overlapScore,
        overlapTrimCandidatePx: transition.overlapTrimCandidatePx,
        overlapTrimRatio: transition.overlapTrimRatio,
        reason: transition.reason,
        recommendedDecision: transition.recommendedDecision,
        decision: decisions[transition.id]
      } satisfies AssemblyReviewItem;
    });

  const pendingCount = items.filter((item) => !item.decision).length;

  return {
    generatedAt: new Date().toISOString(),
    totalCount: items.length,
    pendingCount,
    items
  };
}

async function buildStitchedCropsFromManifest(
  projectId: string,
  manifest: AssemblyManifest,
  decisions: Partial<Record<string, AssemblyReviewDecision>>,
  options: RenderAssemblyOptions,
  onProgress?: PipelineProgressReporter
) {
  const requestedOrder =
    options.orderedCropIndices && options.orderedCropIndices.length > 0
      ? options.orderedCropIndices.filter(
          (cropIndex, position, cropIndices) =>
            Number.isInteger(cropIndex) &&
            cropIndex >= 0 &&
            cropIndex < manifest.crops.length &&
            cropIndices.indexOf(cropIndex) === position
        )
      : (manifest.autoOrderedCropIndices?.length ?? 0) > 0
        ? manifest.autoOrderedCropIndices ?? []
        : manifest.crops.map((crop) => crop.index);
  const forcedCropIndices = options.forcedCropIndices?.filter((cropIndex) => requestedOrder.includes(cropIndex)) ?? [];
  const forcedCropIndexSet = new Set(forcedCropIndices);
  const transitionByPairKey = new Map(
    manifest.transitions.map((transition) => [
      buildTransitionKey(transition.previousCropIndex, transition.currentCropIndex),
      transition
    ])
  );
  const stitchedCrops: AppendedCrop[] = [];

  for (const [sequenceIndex, cropIndex] of requestedOrder.entries()) {
    const crop = manifest.crops[cropIndex];

    if (!crop) {
      continue;
    }

    const cropBuffer = await readFile(getProjectAssetAbsolutePath(projectId, crop.relativePath));
    const previousCrop = stitchedCrops.at(-1);
    const transition = previousCrop
      ? transitionByPairKey.get(buildTransitionKey(previousCrop.cropIndex, cropIndex))
      : undefined;
    const isForcedCrop = forcedCropIndexSet.has(cropIndex);

    let overlapTrimTopPx = 0;
    let trimMode: AssemblyTrimMode = sequenceIndex === 0 ? "initial" : "keep";
    let overlapScore: number | null = transition?.overlapScore ?? null;

    if (isForcedCrop) {
      trimMode = "manual";
    } else if (transition) {
      if (transition.autoTrimApplied) {
        overlapTrimTopPx = transition.overlapTrimCandidatePx;
        trimMode = "auto";
      } else if (decisions[transition.id] === "trim_overlap") {
        overlapTrimTopPx = transition.overlapTrimCandidatePx;
        trimMode = "review";
      }
    }

    let remainingHeight = crop.height - overlapTrimTopPx;

    if (remainingHeight < MIN_NEW_CONTENT_PX || remainingHeight / crop.height < MIN_NEW_CONTENT_RATIO) {
      if (isForcedCrop) {
        overlapTrimTopPx = 0;
        remainingHeight = crop.height;
        trimMode = "manual";
      } else {
        if (onProgress && (sequenceIndex === requestedOrder.length - 1 || (sequenceIndex + 1) % 4 === 0)) {
          await onProgress({
            stage: "rendering",
            label: "악보 재구성 중",
            detail: "선택한 기준으로 악보 이미지를 다시 정리하고 있습니다.",
            progressPercent: 82 + ((sequenceIndex + 1) / Math.max(1, requestedOrder.length)) * 13,
            current: sequenceIndex + 1,
            total: requestedOrder.length,
            unit: "segments"
          });
        }

        continue;
      }
    }

    const appendBuffer =
      overlapTrimTopPx > 0
        ? await sharp(cropBuffer)
            .extract({
              left: 0,
              top: overlapTrimTopPx,
              width: crop.width,
              height: remainingHeight
            })
            .png()
            .toBuffer()
        : cropBuffer;

    stitchedCrops.push({
      frame: {
        id: crop.frameId,
        timestampSec: crop.timestampSec,
        relativePath: crop.relativePath,
        width: crop.width,
        height: crop.height
      },
      sourceRelativePath: crop.relativePath,
      cropIndex,
      width: crop.width,
      height: crop.height,
      appendBuffer,
      appendHeight: remainingHeight,
      overlapTrimTopPx,
      overlapScore,
      gapBefore: sequenceIndex === 0 ? 0 : overlapTrimTopPx > 0 ? 0 : PAGE_BREAK_GAP,
      hash: crop.hash,
      trimMode,
      transitionId: transition?.id
    });

    if (onProgress && (sequenceIndex === requestedOrder.length - 1 || (sequenceIndex + 1) % 4 === 0)) {
      await onProgress({
        stage: "rendering",
        label: "악보 재구성 중",
        detail: "선택한 기준으로 악보 이미지를 다시 정리하고 있습니다.",
        progressPercent: 82 + ((sequenceIndex + 1) / Math.max(1, requestedOrder.length)) * 13,
        current: sequenceIndex + 1,
        total: requestedOrder.length,
        unit: "segments"
      });
    }
  }

  if (stitchedCrops.length === 0) {
    throw new Error("No stitched tab frames remained after overlap cleanup.");
  }

  return {
    stitchedCrops,
    orderedCropIndices: stitchedCrops.map((crop) => crop.cropIndex),
    forcedCropIndices
  };
}

function buildAssemblyEditorState(
  manifest: AssemblyManifest,
  stitchedCrops: AppendedCrop[],
  orderedCropIndices: number[],
  forcedCropIndices: number[]
): AssemblyEditorState {
  const sequence = stitchedCrops.map((crop) => ({
    ...buildAssemblyCropAsset(manifest.crops[crop.cropIndex]),
    trimMode: crop.trimMode,
    overlapTrimTopPx: crop.overlapTrimTopPx,
    overlapScore: crop.overlapScore,
    gapBefore: crop.gapBefore,
    transitionId: crop.transitionId
  })) satisfies AssemblySequenceItem[];

  return {
    generatedAt: new Date().toISOString(),
    cropCount: manifest.crops.length,
    orderedCropIndices,
    forcedCropIndices,
    crops: manifest.crops.map(buildAssemblyCropAsset),
    sequence
  };
}

async function renderAssembledScoreFromManifest(
  projectId: string,
  manifest: AssemblyManifest,
  decisions: Partial<Record<string, AssemblyReviewDecision>>,
  options: RenderAssemblyOptions = {},
  onProgress?: PipelineProgressReporter
) {
  const { stitchedCrops, orderedCropIndices, forcedCropIndices } = await buildStitchedCropsFromManifest(
    projectId,
    manifest,
    decisions,
    options,
    onProgress
  );

  const finalWidth = manifest.normalizationWidth + SHEET_PADDING * 2;
  const finalHeight =
    stitchedCrops.reduce((sum, crop) => sum + crop.appendHeight + crop.gapBefore, 0) + SHEET_PADDING * 2;

  let currentTop = SHEET_PADDING;
  const composites = stitchedCrops.map((crop) => {
    currentTop += crop.gapBefore;

    const composite = {
      input: crop.appendBuffer,
      left: SHEET_PADDING,
      top: currentTop
    };

    currentTop += crop.appendHeight;
    return composite;
  });

  const assembledScoreBuffer = await sharp({
    create: {
      width: finalWidth,
      height: finalHeight,
      channels: 3,
      background: "#fffdf8"
    }
  })
    .composite(composites)
    .png()
    .toBuffer();

  if (onProgress) {
    await onProgress({
      stage: "writing-output",
      label: "결과 저장 중",
      detail: "최종 PNG와 메타데이터를 저장하고 있습니다.",
      progressPercent: 98
    });
  }

  const review = buildAssemblyReviewState(manifest, decisions, orderedCropIndices);
  const editor = buildAssemblyEditorState(manifest, stitchedCrops, orderedCropIndices, forcedCropIndices);
  const generatedAt = new Date().toISOString();
  const scoreRelativePath = path.posix.join("output", "assembled-score.png");
  const metadataRelativePath = path.posix.join("output", "assembled-score.json");

  await writeFile(path.join(getProjectOutputDirectory(projectId), "assembled-score.png"), assembledScoreBuffer);
  await writeFile(
    path.join(getProjectOutputDirectory(projectId), "assembled-score.json"),
    JSON.stringify(
      {
        generatedAt,
        sourceFrameCount: manifest.sourceFrameCount,
        stitchedFrameCount: stitchedCrops.length,
        normalizationWidth: manifest.normalizationWidth,
        roi: manifest.roi,
        review: {
          totalCount: review.totalCount,
          pendingCount: review.pendingCount,
          items: review.items
        },
        editor: {
          autoOrderedCropIndices: manifest.autoOrderedCropIndices ?? orderedCropIndices,
          orderedCropIndices,
          forcedCropIndices
        },
        frames: stitchedCrops.map((crop, index) => ({
          index,
          cropIndex: crop.cropIndex,
          frameId: crop.frame.id,
          timestampSec: crop.frame.timestampSec,
          relativePath: crop.sourceRelativePath,
          width: crop.width,
          height: crop.height,
          appendedHeight: crop.appendHeight,
          overlapTrimTopPx: crop.overlapTrimTopPx,
          overlapScore: crop.overlapScore,
          gapBefore: crop.gapBefore,
          trimMode: crop.trimMode,
          transitionId: crop.transitionId,
          hash: crop.hash
        }))
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    assembledScore: {
      relativePath: scoreRelativePath,
      metadataPath: metadataRelativePath,
      generatedAt,
      width: finalWidth,
      height: finalHeight,
      sourceFrameCount: manifest.sourceFrameCount,
      stitchedFrameCount: stitchedCrops.length
    },
    assemblyEditor: editor,
    assemblyReview: review
  } satisfies AssembleProjectScoreResult;
}

async function loadAssemblyManifest(projectId: string) {
  const manifestRaw = await readFile(getProjectAssetAbsolutePath(projectId, ASSEMBLY_MANIFEST_PATH), "utf8");
  return JSON.parse(manifestRaw) as AssemblyManifest;
}

export async function applyAssemblyReviewDecisions(
  projectId: string,
  decisions: Partial<Record<string, AssemblyReviewDecision>>,
  manualEdit?: AssemblyManualEditState,
  onProgress?: PipelineProgressReporter
) {
  const manifest = await loadAssemblyManifest(projectId);
  return renderAssembledScoreFromManifest(
    projectId,
    manifest,
    decisions,
    {
      orderedCropIndices: manualEdit?.orderedCropIndices,
      forcedCropIndices: manualEdit?.forcedCropIndices
    },
    onProgress
  );
}

export async function applyAssemblyManualEdits(
  projectId: string,
  decisions: Partial<Record<string, AssemblyReviewDecision>>,
  manualEdit: AssemblyManualEditState,
  onProgress?: PipelineProgressReporter
) {
  const manifest = await loadAssemblyManifest(projectId);
  return renderAssembledScoreFromManifest(
    projectId,
    manifest,
    decisions,
    {
      orderedCropIndices: manualEdit.orderedCropIndices,
      forcedCropIndices: manualEdit.forcedCropIndices
    },
    onProgress
  );
}

export async function assembleProjectScore(
  projectId: string,
  frames: ProjectFrameAsset[],
  roi: RoiSelection,
  onProgress?: PipelineProgressReporter
) {
  await ensureProjectSubdirectories(projectId);

  const outputDirectory = getProjectOutputDirectory(projectId);
  const normalizedCropsDirectory = path.join(outputDirectory, "normalized-crops");
  await mkdir(normalizedCropsDirectory, { recursive: true });

  const preparedCrops: PreparedCrop[] = [];
  const autoOrderedCropIndices: number[] = [];

  for (const [frameIndex, frame] of frames.entries()) {
    const frameAbsolutePath = getProjectAssetAbsolutePath(projectId, frame.relativePath);

    const cropLeft = Math.max(0, roi.x);
    const cropTop = Math.max(0, roi.y);
    const cropWidth = Math.max(1, Math.min(roi.width, frame.width - cropLeft));
    const cropHeight = Math.max(1, Math.min(roi.height, frame.height - cropTop));

    if (cropWidth <= 1 || cropHeight <= 1) {
      continue;
    }

    const cropBuffer = await sharp(frameAbsolutePath)
      .extract({
        left: cropLeft,
        top: cropTop,
        width: cropWidth,
        height: cropHeight
      })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();

    const cropMetadata = await sharp(cropBuffer).metadata();

    if (!cropMetadata.width || !cropMetadata.height) {
      continue;
    }

    const signature = await computeCropSignature(cropBuffer);

    preparedCrops.push({
      frame,
      buffer: cropBuffer,
      width: cropMetadata.width,
      height: cropMetadata.height,
      hash: signature.hash
    });

    const cropIndex = preparedCrops.length - 1;

    if (signature.darkRatio >= MIN_TAB_DARK_RATIO) {
      const recentDuplicate = autoOrderedCropIndices
        .slice(-RECENT_DUPLICATE_WINDOW)
        .some((recentCropIndex) => hammingDistance(signature.hash, preparedCrops[recentCropIndex]?.hash ?? "") <= DUPLICATE_HASH_DISTANCE);

      if (!recentDuplicate) {
        autoOrderedCropIndices.push(cropIndex);
      }
    }

    if (onProgress && (frameIndex === 0 || frameIndex === frames.length - 1 || (frameIndex + 1) % 4 === 0)) {
      await onProgress({
        stage: "collecting-crops",
        label: "Tab 프레임 분석 중",
        detail: "선택한 ROI에서 유효한 tab 프레임을 찾고 있습니다.",
        progressPercent: 6 + ((frameIndex + 1) / Math.max(1, frames.length)) * 54,
        current: frameIndex + 1,
        total: frames.length,
        unit: "frames"
      });
    }
  }

  if (preparedCrops.length === 0) {
    throw new Error("No tab crops remained after filtering. Try selecting a different ROI.");
  }

  if (autoOrderedCropIndices.length === 0) {
    throw new Error("No tab-like crops were detected in the selected ROI. Try selecting a different ROI.");
  }

  const targetWidth = selectNormalizationWidth(preparedCrops.map((crop) => crop.width));
  const normalizedCrops: NormalizedCrop[] = [];

  for (const [cropIndex, crop] of preparedCrops.entries()) {
    const normalizedBuffer = await sharp(crop.buffer)
      .resize({
        width: targetWidth
      })
      .png()
      .toBuffer();
    const normalizedMetadata = await sharp(normalizedBuffer).metadata();
    const storedFileName = `crop-${String(cropIndex).padStart(4, "0")}.png`;
    const relativePath = path.posix.join(NORMALIZED_CROPS_DIRECTORY, storedFileName);

    await writeFile(path.join(normalizedCropsDirectory, storedFileName), normalizedBuffer);

    normalizedCrops.push({
      ...crop,
      buffer: normalizedBuffer,
      width: normalizedMetadata.width ?? targetWidth,
      height: normalizedMetadata.height ?? crop.height,
      relativePath,
      analysis: await computeAnalysisImage(
        normalizedBuffer,
        normalizedMetadata.width ?? targetWidth,
        normalizedMetadata.height ?? crop.height
      )
    });

    if (onProgress && (cropIndex === 0 || cropIndex === preparedCrops.length - 1 || (cropIndex + 1) % 3 === 0)) {
      await onProgress({
        stage: "normalizing",
        label: "크기 정렬 중",
        detail: "마디 이미지 폭을 맞추고 있습니다.",
        progressPercent: 64 + ((cropIndex + 1) / Math.max(1, preparedCrops.length)) * 14,
        current: cropIndex + 1,
        total: preparedCrops.length,
        unit: "segments"
      });
    }
  }

  const manifestCrops = normalizedCrops.map((crop, index) => ({
    index,
    frameId: crop.frame.id,
    timestampSec: crop.frame.timestampSec,
    relativePath: crop.relativePath,
    width: crop.width,
    height: crop.height,
    hash: crop.hash
  })) satisfies CropManifestEntry[];

  const transitions: TransitionManifestEntry[] = [];

  for (let previousCropIndex = 0; previousCropIndex < normalizedCrops.length - 1; previousCropIndex += 1) {
    const previousCrop = normalizedCrops[previousCropIndex];

    for (
      let currentCropIndex = previousCropIndex + 1;
      currentCropIndex < Math.min(normalizedCrops.length, previousCropIndex + MAX_TRANSITION_LOOKAHEAD + 1);
      currentCropIndex += 1
    ) {
      const currentCrop = normalizedCrops[currentCropIndex];
      const overlapMatch = findVerticalOverlap(previousCrop.analysis, currentCrop.analysis);

      if (!overlapMatch) {
        continue;
      }

      const overlapTrimCandidatePx = Math.min(
        currentCrop.height - 1,
        Math.max(0, Math.round((overlapMatch.overlapRows / currentCrop.analysis.height) * currentCrop.height))
      );
      const overlapTrimRatio = overlapTrimCandidatePx / Math.max(1, currentCrop.height);

      if (
        overlapTrimCandidatePx <= 0 ||
        overlapTrimRatio > MAX_OVERLAP_TRIM_RATIO ||
        overlapMatch.score > REVIEW_OVERLAP_SCORE
      ) {
        continue;
      }

      const previousEntry = manifestCrops[previousCropIndex];
      const currentEntry = manifestCrops[currentCropIndex];
      const autoTrimApplied = isSafeAutomaticTrim(overlapMatch.score, overlapTrimRatio);

      transitions.push({
        id: buildTransitionId(previousEntry, currentEntry),
        previousCropIndex,
        currentCropIndex,
        overlapScore: overlapMatch.score,
        overlapTrimCandidatePx,
        overlapTrimRatio,
        autoTrimApplied,
        recommendedDecision: "keep_both",
        reason: buildReviewReason(overlapMatch.score, overlapTrimRatio)
      });
    }
  }

  const manifest: AssemblyManifest = {
    generatedAt: new Date().toISOString(),
    sourceFrameCount: frames.length,
    normalizationWidth: targetWidth,
    roi,
    crops: manifestCrops,
    autoOrderedCropIndices,
    transitions
  };

  await writeFile(
    getProjectAssetAbsolutePath(projectId, ASSEMBLY_MANIFEST_PATH),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return renderAssembledScoreFromManifest(projectId, manifest, {}, {}, onProgress);
}

export type { AssembleProjectScoreResult };
