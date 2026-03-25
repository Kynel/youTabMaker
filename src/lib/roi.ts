import type { DraftProject, RoiSelection, SavedRoiSegment, SavedRoiTimeline } from "@/lib/types";

function normalizeSegmentOrder(segments: SavedRoiSegment[]) {
  return [...segments].sort((left, right) => {
    if (left.startTimestampSec !== right.startTimestampSec) {
      return left.startTimestampSec - right.startTimestampSec;
    }

    return left.savedAt.localeCompare(right.savedAt);
  });
}

export function areRoiSelectionsEqual(left: RoiSelection, right: RoiSelection) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.normalized.x === right.normalized.x &&
    left.normalized.y === right.normalized.y &&
    left.normalized.width === right.normalized.width &&
    left.normalized.height === right.normalized.height
  );
}

export function createSavedRoiTimeline(segments: SavedRoiSegment[]): SavedRoiTimeline {
  return {
    updatedAt: new Date().toISOString(),
    segments: normalizeSegmentOrder(segments)
  };
}

export function getProjectRoiSegments(project: Pick<DraftProject, "roi" | "roiTimeline"> | null | undefined) {
  if (project?.roiTimeline?.segments?.length) {
    return normalizeSegmentOrder(project.roiTimeline.segments);
  }

  if (project?.roi) {
    return [
      {
        id: "legacy-initial",
        startTimestampSec: 0,
        startFrameId: null,
        selection: project.roi.selection,
        selectionMode: project.roi.selectionMode,
        savedAt: project.roi.savedAt
      }
    ] satisfies SavedRoiSegment[];
  }

  return [] as SavedRoiSegment[];
}

export function findActiveRoiSegment(segments: SavedRoiSegment[], timestampSec: number) {
  if (segments.length === 0) {
    return null;
  }

  let activeSegment = segments[0] ?? null;

  for (const segment of segments) {
    if (segment.startTimestampSec <= timestampSec) {
      activeSegment = segment;
      continue;
    }

    break;
  }

  return activeSegment;
}
