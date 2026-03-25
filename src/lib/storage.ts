import os from "node:os";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DraftProject, SavedProjectSummary, SavedRoi, SourceFrameAsset } from "@/lib/types";

const DATA_ROOT = process.env.VERCEL
  ? path.join(os.tmpdir(), "youtabmaker")
  : path.join(process.cwd(), ".data");
const PROJECTS_ROOT = path.join(DATA_ROOT, "projects");

export function getProjectDirectory(projectId: string) {
  return path.join(PROJECTS_ROOT, projectId);
}

function getProjectFile(projectId: string) {
  return path.join(getProjectDirectory(projectId), "project.json");
}

function normalizeDraftProject(project: DraftProject) {
  const normalizedTitle = project.title?.trim() || project.normalizedUrl || project.id;

  return {
    ...project,
    title: normalizedTitle,
    updatedAt: project.updatedAt ?? project.createdAt
  } satisfies DraftProject;
}

export function getProjectDownloadsDirectory(projectId: string) {
  return path.join(getProjectDirectory(projectId), "downloads");
}

export function getProjectFramesDirectory(projectId: string) {
  return path.join(getProjectDirectory(projectId), "frames");
}

export function getProjectOutputDirectory(projectId: string) {
  return path.join(getProjectDirectory(projectId), "output");
}

export function getProjectAssetAbsolutePath(projectId: string, relativePath: string) {
  return path.join(getProjectDirectory(projectId), relativePath);
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function extensionFromName(fileName: string) {
  const extension = path.extname(fileName).trim();
  return extension || ".bin";
}

export async function ensureProjectDirectory(projectId: string) {
  await mkdir(getProjectDirectory(projectId), { recursive: true });
}

export async function ensureProjectSubdirectories(projectId: string) {
  await ensureProjectDirectory(projectId);
  await mkdir(getProjectDownloadsDirectory(projectId), { recursive: true });
  await mkdir(getProjectFramesDirectory(projectId), { recursive: true });
  await mkdir(getProjectOutputDirectory(projectId), { recursive: true });
}

export async function resetProjectGeneratedAssets(projectId: string) {
  await rm(getProjectDownloadsDirectory(projectId), { recursive: true, force: true });
  await rm(getProjectFramesDirectory(projectId), { recursive: true, force: true });
  await rm(getProjectOutputDirectory(projectId), { recursive: true, force: true });
  await ensureProjectSubdirectories(projectId);
}

export async function saveDraftProject(project: DraftProject) {
  await ensureProjectDirectory(project.id);
  const normalizedProject = normalizeDraftProject({
    ...project,
    updatedAt: new Date().toISOString()
  });
  await writeFile(getProjectFile(project.id), JSON.stringify(normalizedProject, null, 2), "utf8");
  return normalizedProject;
}

export async function loadDraftProject(projectId: string) {
  const raw = await readFile(getProjectFile(projectId), "utf8");
  return normalizeDraftProject(JSON.parse(raw) as DraftProject);
}

export async function listDraftProjectSummaries(): Promise<SavedProjectSummary[]> {
  await mkdir(PROJECTS_ROOT, { recursive: true });
  const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          const project = await loadDraftProject(entry.name);

          return {
            id: project.id,
            title: project.title,
            sourceUrl: project.sourceUrl,
            normalizedUrl: project.normalizedUrl,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            frameCount: project.frames?.length ?? 0,
            stitchedFrameCount: project.assembledScore?.stitchedFrameCount ?? 0,
            hasAssembledScore: Boolean(project.assembledScore)
          } satisfies SavedProjectSummary;
        } catch {
          return null;
        }
      })
  );

  return projects
    .filter((project): project is SavedProjectSummary => Boolean(project))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function updateDraftProject(
  projectId: string,
  updater: (project: DraftProject) => DraftProject
) {
  const currentProject = await loadDraftProject(projectId);
  const updatedProject = updater(currentProject);
  await saveDraftProject(updatedProject);
  return updatedProject;
}

export async function saveProjectSourceFrame(
  projectId: string,
  file: File,
  metadata?: { width?: number; height?: number }
): Promise<SourceFrameAsset> {
  await ensureProjectDirectory(projectId);

  const safeBaseName = sanitizeFileName(path.basename(file.name, path.extname(file.name)) || "frame");
  const extension = extensionFromName(file.name);
  const storedFileName = `source-frame-${Date.now()}-${safeBaseName}${extension}`;
  const relativePath = storedFileName;
  const absolutePath = path.join(getProjectDirectory(projectId), storedFileName);
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(absolutePath, buffer);

  return {
    originalFileName: file.name,
    storedFileName,
    mimeType: file.type || "application/octet-stream",
    bytes: buffer.byteLength,
    uploadedAt: new Date().toISOString(),
    relativePath,
    width: metadata?.width,
    height: metadata?.height
  };
}

export async function saveProjectRoi(projectId: string, roi: SavedRoi) {
  return updateDraftProject(projectId, (project) => ({
    ...project,
    roi
  }));
}
