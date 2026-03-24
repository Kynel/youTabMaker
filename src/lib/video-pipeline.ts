import { spawn } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  ensureProjectSubdirectories,
  getProjectAssetAbsolutePath,
  getProjectDownloadsDirectory,
  getProjectFramesDirectory,
  getProjectOutputDirectory
} from "@/lib/storage";
import type { AssembledScoreAsset, ProjectFrameAsset, RoiSelection, VideoAsset } from "@/lib/types";

const MIN_TAB_DARK_RATIO = 0.02;
const RECENT_DUPLICATE_WINDOW = 6;
const DUPLICATE_HASH_DISTANCE = 12;
const NORMALIZATION_WIDTH_QUANTILE = 0.75;
const OVERLAP_ANALYSIS_WIDTH = 96;
const MIN_OVERLAP_RATIO = 0.12;
const MAX_OVERLAP_RATIO = 0.92;
const MIN_ACTIVE_OVERLAP_RATIO = 0.035;
const STRICT_OVERLAP_SCORE = 0.095;
const RELAXED_OVERLAP_SCORE = 0.125;
const MIN_NEW_CONTENT_PX = 32;
const MIN_NEW_CONTENT_RATIO = 0.08;
const SHEET_PADDING = 18;
const PAGE_BREAK_GAP = 18;

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
}

interface AppendedCrop extends NormalizedCrop {
  appendBuffer: Buffer;
  appendHeight: number;
  overlapTrimTopPx: number;
  overlapScore: number | null;
  gapBefore: number;
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

  const { stdout } = await runTool("yt-dlp", [
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
  ], undefined, {
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
  });

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

  await runTool("ffmpeg", [
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
  ], undefined, {
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
  });

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

  if (bestCandidate && bestCandidate.score <= RELAXED_OVERLAP_SCORE) {
    return bestCandidate;
  }

  return null;
}

export async function assembleProjectScore(
  projectId: string,
  frames: ProjectFrameAsset[],
  roi: RoiSelection,
  onProgress?: PipelineProgressReporter
): Promise<AssembledScoreAsset> {
  await ensureProjectSubdirectories(projectId);

  const outputDirectory = getProjectOutputDirectory(projectId);
  const preparedCrops: PreparedCrop[] = [];

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
      .trim()
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();

    const cropMetadata = await sharp(cropBuffer).metadata();

    if (!cropMetadata.width || !cropMetadata.height) {
      continue;
    }

    const signature = await computeCropSignature(cropBuffer);

    if (signature.darkRatio < MIN_TAB_DARK_RATIO) {
      continue;
    }

    const recentDuplicate = preparedCrops
      .slice(-RECENT_DUPLICATE_WINDOW)
      .some((crop) => hammingDistance(signature.hash, crop.hash) <= DUPLICATE_HASH_DISTANCE);

    if (recentDuplicate) {
      continue;
    }

    preparedCrops.push({
      frame,
      buffer: cropBuffer,
      width: cropMetadata.width,
      height: cropMetadata.height,
      hash: signature.hash
    });

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

      normalizedCrops.push({
        ...crop,
        buffer: normalizedBuffer,
        width: normalizedMetadata.width ?? targetWidth,
        height: normalizedMetadata.height ?? crop.height,
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

  const stitchedCrops: AppendedCrop[] = [];

  for (const [cropIndex, crop] of normalizedCrops.entries()) {
    const previousCrop = stitchedCrops.at(-1);

    if (!previousCrop) {
      stitchedCrops.push({
        ...crop,
        appendBuffer: crop.buffer,
        appendHeight: crop.height,
        overlapTrimTopPx: 0,
        overlapScore: null,
        gapBefore: 0
      });
      continue;
    }

    const overlapMatch = findVerticalOverlap(previousCrop.analysis, crop.analysis);
    const overlapTrimTopPx = overlapMatch
      ? Math.min(crop.height - 1, Math.max(0, Math.round((overlapMatch.overlapRows / crop.analysis.height) * crop.height)))
      : 0;
    const remainingHeight = crop.height - overlapTrimTopPx;

    if (remainingHeight < MIN_NEW_CONTENT_PX || remainingHeight / crop.height < MIN_NEW_CONTENT_RATIO) {
      continue;
    }

    const appendBuffer =
      overlapTrimTopPx > 0
        ? await sharp(crop.buffer)
            .extract({
              left: 0,
              top: overlapTrimTopPx,
              width: crop.width,
              height: remainingHeight
            })
            .png()
            .toBuffer()
        : crop.buffer;

    stitchedCrops.push({
      ...crop,
      appendBuffer,
      appendHeight: remainingHeight,
      overlapTrimTopPx,
      overlapScore: overlapMatch?.score ?? null,
      gapBefore: overlapTrimTopPx > 0 ? 0 : PAGE_BREAK_GAP
    });

    if (onProgress && (cropIndex === 0 || cropIndex === normalizedCrops.length - 1 || (cropIndex + 1) % 3 === 0)) {
      await onProgress({
        stage: "stitching",
        label: "악보 조합 중",
        detail: "중복과 겹침을 정리하며 하나의 악보로 합치고 있습니다.",
        progressPercent: 80 + ((cropIndex + 1) / Math.max(1, normalizedCrops.length)) * 15,
        current: cropIndex + 1,
        total: normalizedCrops.length,
        unit: "segments"
      });
    }
  }

  if (stitchedCrops.length === 0) {
    throw new Error("No stitched tab frames remained after overlap cleanup.");
  }

  const finalWidth = targetWidth + SHEET_PADDING * 2;
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

  const scoreRelativePath = path.posix.join("output", "assembled-score.png");
  const metadataRelativePath = path.posix.join("output", "assembled-score.json");

  await writeFile(path.join(outputDirectory, "assembled-score.png"), assembledScoreBuffer);
  await writeFile(
    path.join(outputDirectory, "assembled-score.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceFrameCount: frames.length,
        stitchedFrameCount: stitchedCrops.length,
        normalizationWidth: targetWidth,
        roi,
        frames: stitchedCrops.map((crop, index) => ({
          index,
          timestampSec: crop.frame.timestampSec,
          relativePath: crop.frame.relativePath,
          width: crop.width,
          height: crop.height,
          appendedHeight: crop.appendHeight,
          overlapTrimTopPx: crop.overlapTrimTopPx,
          overlapScore: crop.overlapScore,
          gapBefore: crop.gapBefore,
          hash: crop.hash
        }))
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    relativePath: scoreRelativePath,
    metadataPath: metadataRelativePath,
    generatedAt: new Date().toISOString(),
    width: finalWidth,
    height: finalHeight,
    sourceFrameCount: frames.length,
    stitchedFrameCount: stitchedCrops.length
  };
}
