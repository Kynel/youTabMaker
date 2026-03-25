import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { applyRuntimeToProject } from "@/lib/project";
import { createSavedRoiTimeline, findActiveRoiSegment, getProjectRoiSegments } from "@/lib/roi";
import { inspectRuntime } from "@/lib/runtime";
import { loadDraftProject, updateDraftProject } from "@/lib/storage";
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

function buildLegacySavedRoi(segments: SavedRoiSegment[]): SavedRoi | undefined {
  const firstSegment = segments[0];

  if (!firstSegment) {
    return undefined;
  }

  return {
    selection: firstSegment.selection,
    selectionMode: firstSegment.selectionMode,
    savedAt: firstSegment.savedAt
  };
}

async function saveRoiSegments(projectId: string, segments: SavedRoiSegment[]) {
  const roiTimeline = createSavedRoiTimeline(segments);

  return updateDraftProject(projectId, (currentProject) =>
    applyRuntimeToProject(
      {
        ...currentProject,
        roi: buildLegacySavedRoi(roiTimeline.segments),
        roiTimeline,
        assembledScore: undefined,
        assemblyEditor: undefined,
        assemblyManualEdit: undefined,
        assemblyReview: undefined,
        assemblyFailure: undefined
      },
      inspectRuntime()
    )
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;

  let project;

  try {
    project = await loadDraftProject(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as {
    action?: "replace-active" | "insert-from-current";
    roi?: RoiSelection;
    selectionMode?: SavedRoi["selectionMode"];
    startTimestampSec?: number;
    startFrameId?: string | null;
  } | null;

  if (!isValidRoiSelection(payload?.roi)) {
    return NextResponse.json({ error: "A valid ROI payload is required." }, { status: 400 });
  }

  const roi = payload.roi;
  const action = payload?.action === "insert-from-current" ? "insert-from-current" : "replace-active";
  const selectionMode =
    payload?.selectionMode === "bottom-band-suggestion" ? "bottom-band-suggestion" : "manual";
  const startTimestampSec = Math.max(0, payload?.startTimestampSec ?? 0);
  const savedAt = new Date().toISOString();
  const currentSegments = getProjectRoiSegments(project);
  const activeSegment = findActiveRoiSegment(currentSegments, startTimestampSec);
  let nextSegments: SavedRoiSegment[];

  if (action === "replace-active") {
    if (activeSegment) {
      nextSegments = currentSegments.map((segment) =>
        segment.id === activeSegment.id
          ? {
              ...segment,
              selection: roi,
              selectionMode,
              savedAt
            }
          : segment
      );
    } else {
      nextSegments = [
        {
          id: randomUUID(),
          startTimestampSec,
          startFrameId: payload?.startFrameId ?? null,
          selection: roi,
          selectionMode,
          savedAt
        }
      ];
    }
  } else {
    const existingSegment = currentSegments.find((segment) => segment.startTimestampSec === startTimestampSec);

    if (existingSegment) {
      nextSegments = currentSegments.map((segment) =>
        segment.id === existingSegment.id
          ? {
              ...segment,
              startFrameId: payload?.startFrameId ?? segment.startFrameId,
              selection: roi,
              selectionMode,
              savedAt
            }
          : segment
      );
    } else {
      nextSegments = [
        ...currentSegments,
        {
          id: randomUUID(),
          startTimestampSec,
          startFrameId: payload?.startFrameId ?? null,
          selection: roi,
          selectionMode,
          savedAt
        }
      ];
    }
  }

  const updatedProject = await saveRoiSegments(projectId, nextSegments);
  return NextResponse.json({ project: updatedProject });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;

  let project;

  try {
    project = await loadDraftProject(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as { segmentId?: string } | null;
  const currentSegments = getProjectRoiSegments(project);
  const segmentIndex = currentSegments.findIndex((segment) => segment.id === payload?.segmentId);

  if (segmentIndex < 0) {
    return NextResponse.json({ error: "ROI segment not found." }, { status: 404 });
  }

  if (segmentIndex === 0) {
    return NextResponse.json({ error: "The first ROI segment cannot be deleted." }, { status: 400 });
  }

  const updatedProject = await saveRoiSegments(
    projectId,
    currentSegments.filter((segment) => segment.id !== payload?.segmentId)
  );

  return NextResponse.json({ project: updatedProject });
}
