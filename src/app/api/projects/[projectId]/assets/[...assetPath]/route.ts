import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getProjectAssetAbsolutePath, getProjectDirectory } from "@/lib/storage";

export const dynamic = "force-dynamic";

function contentTypeForExtension(extension: string) {
  switch (extension.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".json":
      return "application/json; charset=utf-8";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; assetPath: string[] }> }
) {
  const { projectId, assetPath } = await context.params;
  const relativePath = assetPath.join("/");
  const absolutePath = getProjectAssetAbsolutePath(projectId, relativePath);
  const projectDirectory = getProjectDirectory(projectId);
  const normalizedRelative = path.relative(projectDirectory, absolutePath);

  if (normalizedRelative.startsWith("..")) {
    return NextResponse.json({ error: "Invalid asset path." }, { status: 400 });
  }

  try {
    const fileBuffer = await readFile(absolutePath);
    const extension = path.extname(absolutePath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentTypeForExtension(extension),
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
}
