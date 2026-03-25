import { NextResponse } from "next/server";

import { applyRuntimeToProject } from "@/lib/project";
import { inspectRuntime } from "@/lib/runtime";
import { deleteDraftProject, loadDraftProject, updateDraftProject } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;

  try {
    const project = await loadDraftProject(projectId);
    const hydratedProject = applyRuntimeToProject(project, inspectRuntime());
    return NextResponse.json({ project: hydratedProject });
  } catch {
    return NextResponse.json({ error: "작업을 찾지 못했습니다." }, { status: 404 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const payload = (await request.json().catch(() => null)) as { title?: string } | null;
  const nextTitle = payload?.title?.trim() ?? "";

  if (!nextTitle) {
    return NextResponse.json({ error: "작업 이름을 입력해 주세요." }, { status: 400 });
  }

  if (nextTitle.length > 80) {
    return NextResponse.json({ error: "작업 이름은 80자 이하로 입력해 주세요." }, { status: 400 });
  }

  try {
    const updatedProject = await updateDraftProject(projectId, (project) => ({
      ...project,
      title: nextTitle
    }));
    const hydratedProject = applyRuntimeToProject(updatedProject, inspectRuntime());
    return NextResponse.json({ project: hydratedProject });
  } catch {
    return NextResponse.json({ error: "작업을 찾지 못했습니다." }, { status: 404 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;

  try {
    await loadDraftProject(projectId);
    await deleteDraftProject(projectId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "작업을 찾지 못했습니다." }, { status: 404 });
  }
}
