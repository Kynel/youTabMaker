import { NextResponse } from "next/server";

import { createProjectProgressReporter } from "@/lib/processing";
import { applyRuntimeToProject } from "@/lib/project";
import { createSavedRoiTimeline, getProjectRoiSegments } from "@/lib/roi";
import { inspectRuntime } from "@/lib/runtime";
import { loadDraftProject, updateDraftProject } from "@/lib/storage";
import { assembleProjectScore, TabCropDetectionError } from "@/lib/video-pipeline";
import type { RoiSelection, SavedRoi, SavedRoiSegment } from "@/lib/types";

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
    const currentSegments = getProjectRoiSegments(project);
    let roiSegments = currentSegments;

    if (!project.frames || project.frames.length === 0) {
      return NextResponse.json(
        { error: "No captured frames are available yet. Capture the video first." },
        { status: 400 }
      );
    }

    if (roiSegments.length === 0) {
      if (!isValidRoiSelection(payload?.roi)) {
        return NextResponse.json(
          { error: "Save at least one ROI segment before generating the full score." },
          { status: 400 }
        );
      }

      const savedAt = new Date().toISOString();
      roiSegments = [
        {
          id: "initial-segment",
          startTimestampSec: 0,
          startFrameId: project.frames[0]?.id ?? null,
          selection: payload.roi,
          selectionMode:
            payload.selectionMode === "bottom-band-suggestion" ? "bottom-band-suggestion" : "manual",
          savedAt
        }
      ] satisfies SavedRoiSegment[];
    }

    const roiTimeline = createSavedRoiTimeline(roiSegments);
    const savedRoi: SavedRoi = {
      selection: roiTimeline.segments[0].selection,
      selectionMode: roiTimeline.segments[0].selectionMode,
      savedAt: roiTimeline.segments[0].savedAt
    };

    await updateDraftProject(projectId, (currentProject) => ({
      ...currentProject,
      assemblyFailure: undefined
    }));

    await progress.report({
      stage: "preparing",
      label: "악보 생성 준비 중",
      detail: "ROI와 프레임 정보를 확인하고 있습니다.",
      progressPercent: 3
    });

    const { assembledScore, assemblyEditor, assemblyReview } = await assembleProjectScore(
      projectId,
      project.frames,
      roiTimeline.segments,
      progress.report
    );
    const updatedProject = await updateDraftProject(projectId, (currentProject) =>
      applyRuntimeToProject(
        {
          ...currentProject,
          roi: savedRoi,
          roiTimeline,
          assembledScore,
          assemblyEditor,
          assemblyManualEdit: undefined,
          assemblyReview,
          assemblyFailure: undefined,
          processing: undefined
        },
        inspectRuntime()
      )
    );

    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to assemble the full tab score.";
    let failedProject: ReturnType<typeof applyRuntimeToProject> | undefined;

    if (error instanceof TabCropDetectionError) {
      const updatedProject = await updateDraftProject(projectId, (currentProject) => ({
        ...currentProject,
        assemblyFailure: {
          generatedAt: new Date().toISOString(),
          reason: error.message,
          failedFrameIds: error.failedFrameIds
        }
      }));
      failedProject = applyRuntimeToProject(updatedProject, inspectRuntime());
    }

    await progress.fail(errorMessage);
    await progress.clear();

    return NextResponse.json(
      {
        error: errorMessage,
        project: failedProject
      },
      { status: 500 }
    );
  }
}
