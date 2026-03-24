import { spawnSync } from "node:child_process";

import type { DependencyStatus, RuntimeInspection } from "@/lib/types";

const REQUIRED_TOOLS: Omit<DependencyStatus, "available">[] = [
  {
    id: "yt-dlp",
    label: "yt-dlp",
    purpose: "Fetch a source video and metadata from the provided YouTube URL."
  },
  {
    id: "ffmpeg",
    label: "ffmpeg",
    purpose: "Extract frames and audio snippets for analysis."
  },
  {
    id: "tesseract",
    label: "tesseract",
    purpose: "Run OCR against cropped tab images."
  },
  {
    id: "python3",
    label: "python3",
    purpose: "Optional bridge for future OpenCV-heavy image processing."
  }
];

function isToolAvailable(toolId: string): boolean {
  const result = spawnSync("which", [toolId], { stdio: "ignore" });
  return result.status === 0;
}

export function inspectRuntime(): RuntimeInspection {
  const dependencies = REQUIRED_TOOLS.map((tool) => ({
    ...tool,
    available: isToolAvailable(tool.id)
  }));

  const hasYtDlp = dependencies.find((tool) => tool.id === "yt-dlp")?.available ?? false;
  const hasFfmpeg = dependencies.find((tool) => tool.id === "ffmpeg")?.available ?? false;

  return {
    dependencies,
    canProcessYoutubeUrl: hasYtDlp && hasFfmpeg,
    canProcessImageUpload: true
  };
}
