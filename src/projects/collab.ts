/**
 * The server's collaboration routes (TODO Part 21): finding people, the members of a project
 * and their roles, the share link, asking for access, and the inbox. Each call answers with
 * the parsed result or throws a `CollabError` naming what the server said.
 */
import { z } from "zod";
import { routePath } from "@/app/router";
import { apiBase, authHeaders } from "@/auth/api";
import { LINK_ROLES, ROLES } from "./roles";
import type { LinkRole, Role } from "./roles";

export class CollabError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const Person = z.object({
  id: z.string(),
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
});
export type Person = z.infer<typeof Person>;

const Member = z.object({
  userId: z.string(),
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(ROLES),
  joinedAt: z.string(),
  lastSeenAt: z.string().nullable(),
  invitedBy: z.string().nullable(),
});
export type Member = z.infer<typeof Member>;

const Link = z.object({
  token: z.string(),
  role: z.enum(LINK_ROLES),
  expiresAt: z.string().nullable(),
});
export type ShareLink = z.infer<typeof Link>;

const Request = z.object({
  userId: z.string(),
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  message: z.string().nullable(),
  createdAt: z.string(),
});
export type AccessRequest = z.infer<typeof Request>;

const Notice = z.object({
  id: z.string(),
  kind: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  actor: z
    .object({ id: z.string(), firstName: z.string(), lastName: z.string(), username: z.string() })
    .nullable(),
  payload: z.record(z.string(), z.unknown()),
  count: z.number(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type Notice = z.infer<typeof Notice>;
export const parseNotice = (value: unknown): Notice | null => {
  const parsed = Notice.safeParse(value);
  return parsed.success ? parsed.data : null;
};

async function call<T>(
  method: string,
  path: string,
  schema: z.ZodType<T> | null,
  body?: unknown,
): Promise<T> {
  const base = apiBase();
  if (!base) throw new CollabError(0, "noServer");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(await authHeaders()),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const code = ((await res.json().catch(() => ({}))) as { error?: unknown }).error;
    throw new CollabError(res.status, typeof code === "string" ? code : "failed");
  }
  if (!schema) return undefined as T;
  return schema.parse(await res.json());
}

const project = (id: string) => `/projects/${encodeURIComponent(id)}`;

export const searchPeople = (q: string) =>
  call("GET", `/users/search?q=${encodeURIComponent(q)}`, z.array(Person));

export const listMembers = (id: string) => call("GET", `${project(id)}/members`, z.array(Member));
export const invite = (id: string, userId: string, role: Exclude<Role, "owner">) =>
  call("POST", `${project(id)}/members`, null, { userId, role });
/** A new role; "owner" hands the project over. */
export const changeRole = (id: string, userId: string, role: Role) =>
  call("PATCH", `${project(id)}/members/${encodeURIComponent(userId)}`, null, { role });
export const removeMember = (id: string, userId: string) =>
  call("DELETE", `${project(id)}/members/${encodeURIComponent(userId)}`, null);

export const getLink = (id: string) =>
  call("GET", `${project(id)}/link`, z.object({ link: Link.nullable() })).then((r) => r.link);
export const setLink = (
  id: string,
  settings: { role: LinkRole; expiresAt: string | null; reset?: boolean },
) => call("PUT", `${project(id)}/link`, z.object({ link: Link }), settings).then((r) => r.link);
export const removeLink = (id: string) => call("DELETE", `${project(id)}/link`, null);

export const askForAccess = (id: string, message: string) =>
  call("POST", `${project(id)}/access-requests`, null, message ? { message } : {});
export const accessRequests = (id: string) =>
  call("GET", `${project(id)}/access-requests`, z.array(Request));
export const answerRequest = (id: string, userId: string, role: Exclude<Role, "owner"> | null) =>
  call("POST", `${project(id)}/access-requests/${encodeURIComponent(userId)}`, null, { role });

export const inbox = () =>
  call("GET", "/notifications", z.object({ items: z.array(Notice), unread: z.number() }));
export const markRead = (ids: string[] | "all") =>
  call("POST", "/notifications/read", null, ids === "all" ? { all: true } : { ids });

/** The address that opens the project for someone who has the share link. */
export function shareUrl(projectId: string, token: string): string {
  const query = new URLSearchParams({ project: projectId, link: token });
  return `${window.location.origin}${routePath({ page: "editor" }, import.meta.env.BASE_URL)}?${query.toString()}`;
}

// Files ------------------------------------------------------------------------------------

const ProjectFile = z.object({
  id: z.string(),
  slot: z.string().nullable(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  uploadedBy: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }).nullable(),
  createdAt: z.string(),
});
export type ProjectFile = z.infer<typeof ProjectFile>;

/** What may be uploaded; the server checks the same list. */
export const FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
]);
export const MAX_FILE_BYTES = 52_428_800;

export const listFiles = (id: string) => call("GET", `${project(id)}/files`, z.array(ProjectFile));
export const deleteFile = (id: string, fileId: string) =>
  call("DELETE", `${project(id)}/files/${encodeURIComponent(fileId)}`, null);

export async function uploadFile(id: string, file: File, slot?: string): Promise<ProjectFile> {
  const base = apiBase();
  if (!base) throw new CollabError(0, "noServer");
  const res = await fetch(`${base}${project(id)}/files`, {
    method: "POST",
    headers: {
      "content-type": file.type,
      "x-file-name": encodeURIComponent(file.name),
      ...(slot ? { "x-slot": slot } : {}),
      ...(await authHeaders()),
    },
    body: file,
  });
  if (!res.ok) throw new CollabError(res.status, "uploadFailed");
  return ProjectFile.parse(await res.json());
}

/** The file's bytes, read with the person's token (a plain link could not carry it). */
export async function fileBlob(id: string, fileId: string): Promise<Blob> {
  const base = apiBase();
  if (!base) throw new CollabError(0, "noServer");
  const res = await fetch(`${base}${project(id)}/files/${encodeURIComponent(fileId)}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new CollabError(res.status, "readFailed");
  return res.blob();
}

// Threads ----------------------------------------------------------------------------------

const ThreadTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("building") }),
  z.object({ kind: z.literal("wall"), wallIndex: z.number() }),
  z.object({ kind: z.literal("opening"), storeyId: z.string(), id: z.string() }),
  z.object({ kind: z.literal("room"), storeyId: z.string(), id: z.string() }),
  z.object({ kind: z.literal("storey"), id: z.string() }),
]);

const Comment = z.object({
  id: z.string(),
  authorId: z.string().nullable(),
  authorName: z.string(),
  text: z.string(),
  attachments: z.array(z.string()),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
});
export type ThreadComment = z.infer<typeof Comment>;

const Thread = z.object({
  id: z.string(),
  target: ThreadTarget,
  version: z.number(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  comments: z.array(Comment),
});
export type Thread = z.infer<typeof Thread>;

const threadsOf = (id: string) => `${project(id)}/threads`;
export const listThreads = (id: string) => call("GET", threadsOf(id), z.array(Thread));
export const startThread = (
  id: string,
  target: Thread["target"],
  text: string,
  attachments: string[] = [],
) => call("POST", threadsOf(id), z.object({ id: z.string() }), { target, text, attachments });
export const replyTo = (id: string, threadId: string, text: string, attachments: string[] = []) =>
  call("POST", `${threadsOf(id)}/${encodeURIComponent(threadId)}/comments`, null, {
    text,
    attachments,
  });
export const resolveThread = (id: string, threadId: string, resolved: boolean) =>
  call("PATCH", `${threadsOf(id)}/${encodeURIComponent(threadId)}`, null, { resolved });
export const editComment = (id: string, commentId: string, text: string) =>
  call("PATCH", `${threadsOf(id)}/comments/${encodeURIComponent(commentId)}`, null, { text });
export const deleteComment = (id: string, commentId: string) =>
  call("DELETE", `${threadsOf(id)}/comments/${encodeURIComponent(commentId)}`, null);

// Named versions ---------------------------------------------------------------------------

const Named = z.object({
  id: z.string(),
  version: z.number(),
  name: z.string(),
  namedBy: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }).nullable(),
  createdAt: z.string(),
});
export type NamedVersion = z.infer<typeof Named>;

const named = (id: string) => `${project(id)}/named`;
export const listNamed = (id: string) => call("GET", named(id), z.array(Named));
export const nameVersion = (id: string, name: string, version?: number) =>
  call("POST", named(id), z.object({ id: z.string(), version: z.number() }), {
    name,
    ...(version ? { version } : {}),
  });
export const renameNamed = (id: string, namedId: string, name: string) =>
  call("PATCH", `${named(id)}/${encodeURIComponent(namedId)}`, null, { name });
export const deleteNamed = (id: string, namedId: string) =>
  call("DELETE", `${named(id)}/${encodeURIComponent(namedId)}`, null);
