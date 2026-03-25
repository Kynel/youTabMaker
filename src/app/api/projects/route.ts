import { NextResponse } from "next/server";

import { listDraftProjectSummaries } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projects = await listDraftProjectSummaries();
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list saved projects."
      },
      { status: 500 }
    );
  }
}
