import { NextResponse } from "next/server";

import { loadDraftProject, saveProjectSourceFrame, updateDraftProject } from "@/lib/storage";

export const dynamic = "force-dynamic";

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

  const formData = await request.formData();
  const sourceFrame = formData.get("sourceFrame");

  if (!(sourceFrame instanceof File)) {
    return NextResponse.json({ error: "An image file is required." }, { status: 400 });
  }

  const width = Number(formData.get("width"));
  const height = Number(formData.get("height"));

  const asset = await saveProjectSourceFrame(projectId, sourceFrame, {
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined
  });

  const project = await updateDraftProject(projectId, (currentProject) => ({
    ...currentProject,
    sourceFrame: asset
  }));

  return NextResponse.json({ project });
}
