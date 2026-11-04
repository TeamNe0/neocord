import { readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { classifyFile, normalizePath, type FileClassification } from "@teamneo/neocord-routing";

export interface NeocordSettings {
  sourceDir?: string;
  featuresDir?: string;
}

export interface Project {
  readonly root: string;
  readonly sourceDir: string;
  readonly featuresDir: string;
  readonly featuresPath: string;
}

export interface ProjectFile {
  readonly path: string;
  readonly classification: FileClassification;
}

export interface LintedFile extends ProjectFile {
  readonly project: Project;
  readonly name: string;
  readonly insideSource: boolean;
}

interface ScanEntry {
  readonly expires: number;
  readonly files: readonly ProjectFile[];
}

const SCAN_TTL_MS = 2000;
const SCANNED_EXTENSION = /\.tsx?$/;
const scans = new Map<string, ScanEntry>();

function readSettings(settings: Record<string, unknown> | undefined): NeocordSettings {
  const raw = settings?.neocord;
  if (typeof raw !== "object" || raw === null) return {};
  const { sourceDir, featuresDir } = raw as Record<string, unknown>;
  return {
    ...(typeof sourceDir === "string" && sourceDir.length > 0 ? { sourceDir } : {}),
    ...(typeof featuresDir === "string" && featuresDir.length > 0 ? { featuresDir } : {}),
  };
}

export function resolveProject(cwd: string, settings: Record<string, unknown> | undefined): Project {
  const { sourceDir, featuresDir } = readSettings(settings);
  const sourcePath = resolve(cwd, sourceDir ?? "src");
  const featuresPath = featuresDir ? resolve(cwd, featuresDir) : join(sourcePath, "features");
  const root = dirname(sourcePath);
  return {
    root,
    sourceDir: basename(sourcePath),
    featuresDir: normalizePath(relative(root, featuresPath)),
    featuresPath,
  };
}

function classify(project: Project, path: string): FileClassification {
  return classifyFile(path, { sourceDir: project.sourceDir, featuresDir: project.featuresDir });
}

export function describeFile(cwd: string, filename: string, settings: Record<string, unknown> | undefined): LintedFile {
  const project = resolveProject(cwd, settings);
  const absolute = resolve(cwd, filename);
  const path = normalizePath(relative(project.root, absolute));
  return {
    project,
    path,
    name: basename(absolute),
    insideSource: path.startsWith(`${project.sourceDir}/`),
    classification: classify(project, path),
  };
}

function walk(directory: string, visit: (path: string) => void): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, visit);
    else if (entry.isFile() && SCANNED_EXTENSION.test(entry.name)) visit(path);
  }
}

export function scanProject(project: Project): readonly ProjectFile[] {
  const now = Date.now();
  const key = `${project.root}\0${project.sourceDir}\0${project.featuresDir}`;
  const cached = scans.get(key);
  if (cached && cached.expires > now) return cached.files;

  const files: ProjectFile[] = [];
  walk(project.featuresPath, (absolute) => {
    const path = normalizePath(relative(project.root, absolute));
    files.push({ path, classification: classify(project, path) });
  });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  scans.set(key, { expires: now + SCAN_TTL_MS, files });
  return files;
}
