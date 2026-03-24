import { updateDraftProject } from "@/lib/storage";
import type { ProjectProcessingKind, ProjectProcessingStatus } from "@/lib/types";

interface ProcessingUpdateInput {
  stage: string;
  label: string;
  detail: string;
  progressPercent: number;
  current?: number;
  total?: number;
  unit?: string;
}

function clampProgress(progressPercent: number) {
  return Math.max(0, Math.min(100, Math.round(progressPercent)));
}

export function createProjectProgressReporter(projectId: string, kind: ProjectProcessingKind) {
  const startedAt = new Date().toISOString();
  let writeChain = Promise.resolve();
  let lastSignature = "";

  async function persist(update: ProcessingUpdateInput) {
    const signature = [
      update.stage,
      clampProgress(update.progressPercent),
      update.current ?? "",
      update.total ?? "",
      update.detail
    ].join("|");

    if (signature === lastSignature) {
      return;
    }

    lastSignature = signature;

    writeChain = writeChain
      .then(async () => {
        await updateDraftProject(projectId, (project) => ({
          ...project,
          processing: {
            kind,
            stage: update.stage,
            label: update.label,
            detail: update.detail,
            progressPercent: clampProgress(update.progressPercent),
            current: update.current,
            total: update.total,
            unit: update.unit,
            startedAt,
            updatedAt: new Date().toISOString()
          } satisfies ProjectProcessingStatus
        }));
      })
      .catch(() => undefined);

    await writeChain;
  }

  return {
    report: persist,
    async fail(detail: string) {
      await persist({
        stage: "failed",
        label: kind === "capture" ? "캡처 실패" : "악보 생성 실패",
        detail,
        progressPercent: 100
      });
    }
  };
}
