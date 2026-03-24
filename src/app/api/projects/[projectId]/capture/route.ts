import { NextResponse } from "next/server";

import { createProjectProgressReporter } from "@/lib/processing";
import { applyRuntimeToProject } from "@/lib/project";
import { inspectRuntime } from "@/lib/runtime";
import { loadDraftProject, resetProjectGeneratedAssets, updateDraftProject } from "@/lib/storage";
import { downloadProjectVideo, extractProjectFrames } from "@/lib/video-pipeline";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const progress = createProjectProgressReporter(projectId, "capture");

  try {
    const project = await loadDraftProject(projectId);

    await progress.report({
      stage: "preparing",
      label: "캡처 준비 중",
      detail: "기존 결과를 정리하고 있습니다.",
      progressPercent: 2
    });

    await resetProjectGeneratedAssets(projectId);
    await progress.report({
      stage: "downloading",
      label: "영상 다운로드 중",
      detail: "유튜브 원본 영상을 가져오고 있습니다.",
      progressPercent: 6
    });

    const videoAsset = await downloadProjectVideo(projectId, project.normalizedUrl, progress.report);

    await progress.report({
      stage: "extracting",
      label: "프레임 추출 중",
      detail: "1초 간격으로 영상을 캡처하고 있습니다.",
      progressPercent: 42
    });

    const frames = await extractProjectFrames(projectId, videoAsset, progress.report);

    const updatedProject = await updateDraftProject(projectId, (currentProject) =>
      applyRuntimeToProject(
        {
          ...currentProject,
          videoAsset,
          frames,
          assembledScore: undefined,
          assemblyEditor: undefined,
          assemblyManualEdit: undefined,
          assemblyReview: undefined,
          processing: undefined
        },
        inspectRuntime()
      )
    );

    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    await progress.fail(error instanceof Error ? error.message : "Failed to capture frames from the YouTube video.");

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to capture frames from the YouTube video."
      },
      { status: 500 }
    );
  }
}
