/**
 * The files of the open server project, shared by the Files tab and the layers tree, kept
 * apart from the editor store like the threads (they are not the building). Loaded when a
 * component asks for a project, and again after an upload or a delete.
 */
import { create } from "zustand";
import { FILE_TYPES, MAX_FILE_BYTES, deleteFile, listFiles, uploadFile } from "./collab";
import type { ProjectFile } from "./collab";

interface FilesState {
  projectId: string | null;
  files: ProjectFile[] | null;
  failed: boolean;
}

export const useProjectFiles = create<FilesState>(() => ({
  projectId: null,
  files: null,
  failed: false,
}));

let loading = 0;

/** Fetches the project's files; a newer load wins over an older one. */
export async function reloadFiles(projectId: string): Promise<void> {
  const ticket = ++loading;
  if (useProjectFiles.getState().projectId !== projectId) {
    useProjectFiles.setState({ projectId, files: null, failed: false });
  }
  try {
    const files = await listFiles(projectId);
    if (ticket === loading) useProjectFiles.setState({ projectId, files, failed: false });
  } catch {
    if (ticket === loading) useProjectFiles.setState({ failed: true });
  }
}

/** Why a file was not uploaded, for the person's language. */
export interface UploadProblem {
  name: string;
  reason: "wrongType" | "tooBig" | "failed";
}

/** Uploads what the person picked, checked as the server checks it, then reloads the list. */
export async function uploadFiles(
  projectId: string,
  files: Iterable<File>,
  onFile?: (name: string) => void,
): Promise<UploadProblem[]> {
  const problems: UploadProblem[] = [];
  for (const file of files) {
    if (!FILE_TYPES.has(file.type)) problems.push({ name: file.name, reason: "wrongType" });
    else if (file.size > MAX_FILE_BYTES) problems.push({ name: file.name, reason: "tooBig" });
    else {
      onFile?.(file.name);
      await uploadFile(projectId, file).catch(() => {
        problems.push({ name: file.name, reason: "failed" });
      });
    }
  }
  await reloadFiles(projectId);
  return problems;
}

/** The window event the sync client sends when the server says the files changed. */
export const FILES_EVENT = "bauwerk:files";

let started = false;

/** Reloads the list shown whenever the files of the open project change. */
export function startFiles(): void {
  if (started) return;
  started = true;
  window.addEventListener(FILES_EVENT, () => {
    const { projectId } = useProjectFiles.getState();
    if (projectId) void reloadFiles(projectId);
  });
}

export async function removeFile(projectId: string, fileId: string): Promise<void> {
  await deleteFile(projectId, fileId).catch(() => undefined);
  await reloadFiles(projectId);
}
