import { NextResponse } from "next/server";

import type { RoiSelection, SavedRoi } from "@/lib/types";
import { loadDraftProject, saveProjectRoi } from "@/lib/storage";

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

  try {
    await loadDraftProject(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as {
    roi?: RoiSelection;
    selectionMode?: SavedRoi["selectionMode"];
  } | null;

  if (!isValidRoiSelection(payload?.roi)) {
    return NextResponse.json({ error: "A valid ROI payload is required." }, { status: 400 });
  }

  const savedRoi: SavedRoi = {
    selection: payload.roi,
    selectionMode:
      payload.selectionMode === "bottom-band-suggestion" ? "bottom-band-suggestion" : "manual",
    savedAt: new Date().toISOString()
  };

  const project = await saveProjectRoi(projectId, savedRoi);

  return NextResponse.json({ project });
}
