import { NextResponse } from "next/server";

import { applyRuntimeToProject } from "@/lib/project";
import { inspectRuntime } from "@/lib/runtime";
import { loadDraftProject } from "@/lib/storage";

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
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
}
