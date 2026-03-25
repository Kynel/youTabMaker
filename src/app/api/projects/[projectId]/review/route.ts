import { NextResponse } from "next/server";

import { createProjectProgressReporter } from "@/lib/processing";
import { applyRuntimeToProject } from "@/lib/project";
import { inspectRuntime } from "@/lib/runtime";
import { loadDraftProject, updateDraftProject } from "@/lib/storage";
import { applyAssemblyReviewDecisions } from "@/lib/video-pipeline";
import type { AssemblyReviewDecision } from "@/lib/types";

export const dynamic = "force-dynamic";

function isValidDecision(value: unknown): value is AssemblyReviewDecision {
  return value === "keep_both" || value === "trim_overlap";
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
      decisions?: Record<string, unknown>;
    } | null;

    if (!project.assembledScore || !project.assemblyReview) {
      return NextResponse.json(
        { error: "No assembled score is available yet. Generate the full tab first." },
        { status: 400 }
      );
    }

    const nextDecisions = Object.entries(payload?.decisions ?? {}).reduce(
      (accumulator, [reviewId, decision]) => {
        if (isValidDecision(decision)) {
          accumulator[reviewId] = decision;
        }

        return accumulator;
      },
      {} as Record<string, AssemblyReviewDecision>
    );

    const storedDecisions = Object.fromEntries(
      project.assemblyReview.items.flatMap((item) => (item.decision ? [[item.id, item.decision]] : []))
    ) as Record<string, AssemblyReviewDecision>;

    await progress.report({
      stage: "reviewing",
      label: "검수 반영 중",
      detail: "의심 구간 선택을 바탕으로 악보를 다시 정리하고 있습니다.",
      progressPercent: 8
    });

    const { assembledScore, assemblyEditor, assemblyReview } = await applyAssemblyReviewDecisions(
      projectId,
      {
        ...storedDecisions,
        ...nextDecisions
      },
      project.assemblyManualEdit,
      progress.report
    );

    const updatedProject = await updateDraftProject(projectId, (currentProject) =>
      applyRuntimeToProject(
        {
          ...currentProject,
          assembledScore,
          assemblyEditor,
          assemblyManualEdit: currentProject.assemblyManualEdit,
          assemblyReview,
          processing: undefined
        },
        inspectRuntime()
      )
    );

    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    await progress.fail(error instanceof Error ? error.message : "Failed to apply the review decisions.");
    await progress.clear();

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to apply the review decisions."
      },
      { status: 500 }
    );
  }
}
