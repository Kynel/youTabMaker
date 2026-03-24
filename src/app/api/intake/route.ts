import { NextResponse } from "next/server";

import { createDraftProject } from "@/lib/project";
import { inspectRuntime } from "@/lib/runtime";
import { saveDraftProject } from "@/lib/storage";
import { isYouTubeUrl, normalizeYouTubeUrl } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const sourceUrl = body?.url?.trim() ?? "";

  if (!sourceUrl) {
    return NextResponse.json(
      { error: "YouTube URL is required." },
      { status: 400 }
    );
  }

  if (!isYouTubeUrl(sourceUrl)) {
    return NextResponse.json(
      { error: "Please provide a valid YouTube watch, shorts, or youtu.be URL." },
      { status: 400 }
    );
  }

  const normalizedUrl = normalizeYouTubeUrl(sourceUrl);
  const runtime = inspectRuntime();
  const project = createDraftProject(sourceUrl, normalizedUrl, runtime);
  await saveDraftProject(project);

  return NextResponse.json({ project });
}
