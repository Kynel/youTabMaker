import { NextResponse } from "next/server";

import { createProjectProgressReporter } from "@/lib/processing";
import { applyRuntimeToProject } from "@/lib/project";
import { inspectRuntime } from "@/lib/runtime";
import { loadDraftProject, updateDraftProject } from "@/lib/storage";
import { assembleProjectScore } from "@/lib/video-pipeline";
import type { RoiSelection, SavedRoi } from "@/lib/types";

export const dynamic = "force-dynamic";

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidRoiSelection(value: unknown): value is RoiSelection {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as RoiSelection;

  return (
    isFiniteNumber(candidate.x) &&
    isFiniteNumber(candidate.y) &&
    isFiniteNumber(candidate.width) &&
    isFiniteNumber(candidate.height) &&
    candidate.width > 0 &&
    candidate.height > 0 &&
    isFiniteNumber(candidate.normalized?.x) &&
    isFiniteNumber(candidate.normalized?.y) &&
    isFiniteNumber(candidate.normalized?.width) &&
    isFiniteNumber(candidate.normalized?.height)
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const progress = createProjectProgressReporter(projectId, "assemble");

  try {
    const project = await loadDraftProject(projectId);
    const payload = (await request.json().catch(() => null)) as {
      roi?: RoiSelection;
      selectionMode?: SavedRoi["selectionMode"];
    } | null;

    if (!isValidRoiSelection(payload?.roi)) {
      return NextResponse.json({ error: "A valid ROI payload is required." }, { status: 400 });
    }

    if (!project.frames || project.frames.length === 0) {
      return NextResponse.json(
        { error: "No captured frames are available yet. Capture the video first." },
        { status: 400 }
      );
    }

    const savedRoi: SavedRoi = {
      selection: payload.roi,
      selectionMode:
        payload.selectionMode === "bottom-band-suggestion" ? "bottom-band-suggestion" : "manual",
      savedAt: new Date().toISOString()
    };

    await progress.report({
      stage: "preparing",
      label: "악보 생성 준비 중",
      detail: "ROI와 프레임 정보를 확인하고 있습니다.",
      progressPercent: 3
    });

    const { assembledScore, assemblyEditor, assemblyReview } = await assembleProjectScore(
      projectId,
      project.frames,
      payload.roi,
      progress.report
    );
    const updatedProject = await updateDraftProject(projectId, (currentProject) =>
      applyRuntimeToProject(
        {
          ...currentProject,
          roi: savedRoi,
          assembledScore,
          assemblyEditor,
          assemblyManualEdit: undefined,
          assemblyReview,
          processing: undefined
        },
        inspectRuntime()
      )
    );

    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    await progress.fail(error instanceof Error ? error.message : "Failed to assemble the full tab score.");

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to assemble the full tab score."
      },
      { status: 500 }
    );
  }
}
