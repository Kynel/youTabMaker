import { NextResponse } from "next/server";

import { createProjectProgressReporter } from "@/lib/processing";
import { applyRuntimeToProject } from "@/lib/project";
import { inspectRuntime } from "@/lib/runtime";
import { loadDraftProject, updateDraftProject } from "@/lib/storage";
import { applyAssemblyManualEdits } from "@/lib/video-pipeline";
import type { AssemblyManualEditState, AssemblyReviewDecision } from "@/lib/types";

export const dynamic = "force-dynamic";

function sanitizeCropIndices(values: unknown, cropCount: number) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter(
    (value, index, currentValues) =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value < cropCount &&
      currentValues.indexOf(value) === index
  ) as number[];
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
      orderedCropIndices?: unknown;
      forcedCropIndices?: unknown;
    } | null;

    if (!project.assembledScore || !project.assemblyEditor) {
      return NextResponse.json(
        { error: "No assembled score is available yet. Generate the full tab first." },
        { status: 400 }
      );
    }

    const orderedCropIndices = sanitizeCropIndices(
      payload?.orderedCropIndices,
      project.assemblyEditor.cropCount
    );

    if (orderedCropIndices.length === 0) {
      return NextResponse.json({ error: "At least one crop must remain in the score." }, { status: 400 });
    }

    const forcedCropIndices = sanitizeCropIndices(
      payload?.forcedCropIndices,
      project.assemblyEditor.cropCount
    ).filter((cropIndex) => orderedCropIndices.includes(cropIndex));

    const manualEdit: AssemblyManualEditState = {
      updatedAt: new Date().toISOString(),
      orderedCropIndices,
      forcedCropIndices
    };

    const reviewDecisions = Object.fromEntries(
      (project.assemblyReview?.items ?? []).flatMap((item) => (item.decision ? [[item.id, item.decision]] : []))
    ) as Record<string, AssemblyReviewDecision>;

    await progress.report({
      stage: "editing",
      label: "악보 수정 중",
      detail: "추가/삭제한 tab 조각으로 최종 악보를 다시 만들고 있습니다.",
      progressPercent: 8
    });

    const { assembledScore, assemblyEditor, assemblyReview } = await applyAssemblyManualEdits(
      projectId,
      reviewDecisions,
      manualEdit,
      progress.report
    );

    const updatedProject = await updateDraftProject(projectId, (currentProject) =>
      applyRuntimeToProject(
        {
          ...currentProject,
          assembledScore,
          assemblyEditor,
          assemblyManualEdit: manualEdit,
          assemblyReview,
          processing: undefined
        },
        inspectRuntime()
      )
    );

    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    await progress.fail(error instanceof Error ? error.message : "Failed to apply the manual score edit.");
    await progress.clear();

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to apply the manual score edit."
      },
      { status: 500 }
    );
  }
}
