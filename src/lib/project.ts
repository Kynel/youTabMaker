import { randomUUID } from "node:crypto";

import type { DraftProject, PipelineStep, RuntimeInspection } from "@/lib/types";

function buildPipeline(runtime: RuntimeInspection): PipelineStep[] {
  return [
    {
      id: "intake",
      label: "URL intake",
      description: "Validate the YouTube link and create a project for assembling one full tab score.",
      status: "ready"
    },
    {
      id: "frames",
      label: "Frame collection",
      description: runtime.canProcessYoutubeUrl
        ? "The machine can already download the YouTube source and extract 1-second interval frames automatically."
        : "Blocked on `yt-dlp` and `ffmpeg`. Use manual frame uploads and stitching for now.",
      status: runtime.canProcessYoutubeUrl ? "ready" : "blocked"
    },
    {
      id: "roi",
      label: "ROI selection",
      description:
        "Manual tab-region selection is available now. The crop should stay user-correctable even after auto-detection is added.",
      status: "ready"
    },
    {
      id: "assembly",
      label: "Score assembly",
      description:
        "The current pipeline crops the saved ROI across the full video, removes near-duplicates, normalizes sizes, and stitches one long score image.",
      status: "ready"
    },
    {
      id: "export",
      label: "Export",
      description:
        "Export the combined score as PNG and JSON now. Delay Songsterr-like playback until note extraction is reliable.",
      status: "planned"
    }
  ];
}

export function createDraftProject(sourceUrl: string, normalizedUrl: string, runtime: RuntimeInspection): DraftProject {
  return applyRuntimeToProject(
    {
      id: `draft-${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      sourceUrl,
      normalizedUrl,
      recommendedMode: runtime.canProcessYoutubeUrl ? "youtube-url" : "image-upload",
      warnings: [],
      pipeline: buildPipeline(runtime),
      runtime
    },
    runtime
  );
}

export function applyRuntimeToProject(project: DraftProject, runtime: RuntimeInspection): DraftProject {
  const warnings: string[] = [];

  if (!runtime.canProcessYoutubeUrl) {
    warnings.push(
      "Local URL-to-frame processing is unavailable on this machine. Manual frame stitching remains the fallback path."
    );
  }

  if (!runtime.dependencies.find((tool) => tool.id === "tesseract")?.available) {
    warnings.push("OCR is not wired yet and `tesseract` is currently unavailable on this machine.");
  }

  return {
    ...project,
    recommendedMode: runtime.canProcessYoutubeUrl ? "youtube-url" : "image-upload",
    warnings,
    pipeline: buildPipeline(runtime),
    runtime
  };
}
