/**
 * An upload to one of the AI services. They share one graphics card and run one job at a time,
 * in the order the jobs came, so a job may wait behind other people's photos and plans.
 *
 * The upload asks to be answered in the background (Prefer: respond-async): the service takes
 * it and answers 202 at once, and this asks every second how many jobs are ahead of it, which
 * the progress card shows, until the service says it is done; then it collects the answer. So
 * no request waits in line: the tunnel to the PC with the card (Cloudflare) cuts any request
 * that takes longer than 100 seconds. Asking also tells the service that someone still waits:
 * a job nobody asks for any more is dropped when its turn comes.
 */
import { authHeaders } from "@/auth/api";
import { AI_HOST } from "@/lib/aiHost";
import { randomId } from "@/lib/ids";
import { UserError } from "./errors";

const ASK_MS = 1000;
/** This many questions in a row without an answer, and the job counts as lost (the PC went off). */
const LOST_AFTER = 30;

/**
 * Statuses that mean the AI cannot be reached at all: the proxy finds nothing listening (502,
 * 504), or Cloudflare cannot reach the PC (520 to 524, 530 when the tunnel is down).
 */
export function aiUnreachable(status: number): boolean {
  return status === 502 || status === 504 || (status >= 520 && status <= 524) || status === 530;
}

/** What to tell the user when the AI went away: the computer it runs on is off, if one is named. */
export function aiDownError(service: "vision" | "plan"): UserError {
  if (AI_HOST) return new UserError("ai.offHost", { host: AI_HOST });
  return new UserError(service === "vision" ? "photo.error.visionDown" : "ai.off");
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

/**
 * Posts `form` to `base + path` with a job id and returns the job's answer as a Response,
 * reporting the jobs ahead through `onAhead` while it waits.
 */
export async function postInLine(
  base: string,
  path: string,
  form: FormData,
  signal?: AbortSignal,
  onAhead?: (ahead: number) => void,
): Promise<Response> {
  const id = randomId();
  const posted = await fetch(`${base}${path}`, {
    method: "POST",
    body: form,
    signal,
    // Signed in: the hosted site lets only members of Bauwerk use the graphics card.
    headers: { "x-job-id": id, prefer: "respond-async", ...(await authHeaders()) },
  });
  // An error before the line (a bad image, the AI off), or a service that answers directly.
  if (posted.status !== 202) return posted;

  let misses = 0;
  let last: Response | null = null;
  for (;;) {
    await pause(ASK_MS, signal);
    try {
      const res = await fetch(`${base}/queue/${id}`, { signal, headers: await authHeaders() });
      if (res.ok) {
        misses = 0;
        const { ahead, done } = (await res.json()) as { ahead?: unknown; done?: unknown };
        if (done === true) break;
        if (typeof ahead === "number") onAhead?.(ahead);
        continue;
      }
      // 404 for a moment between the upload and the line; for long, the service lost the job.
      last = res;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    if (++misses >= LOST_AFTER) {
      return last && !aiUnreachable(last.status) && last.status !== 404
        ? last
        : new Response(null, { status: 502 });
    }
  }
  return fetch(`${base}/result/${id}`, { signal, headers: await authHeaders() });
}
