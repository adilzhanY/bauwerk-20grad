/**
 * An upload to one of the AI services. They run one job at a time on the one graphics card, so
 * a job may wait behind someone else's. While the answer is outstanding this asks every second
 * how many jobs are ahead of it, which the progress card shows, and which also tells the service
 * that someone still waits: a job nobody asks for any more is dropped when its turn comes.
 */
const ASK_MS = 1000;

/** Posts `form` to `base + path` with a job id, reporting the jobs ahead through `onAhead`. */
export async function postInLine(
  base: string,
  path: string,
  form: FormData,
  signal?: AbortSignal,
  onAhead?: (ahead: number) => void,
): Promise<Response> {
  const id = crypto.randomUUID();
  let answered = false;
  // A function, because TypeScript keeps `answered` narrowed across an await.
  const over = () => answered || signal?.aborted === true;
  const ask = async () => {
    while (!over()) {
      await new Promise((resolve) => setTimeout(resolve, ASK_MS));
      if (over()) return;
      try {
        const res = await fetch(`${base}/queue/${id}`, { signal });
        // 404: not in line yet (still uploading) or already done.
        if (!res.ok) continue;
        const { ahead } = (await res.json()) as { ahead?: unknown };
        if (!over() && typeof ahead === "number") onAhead?.(ahead);
      } catch {
        // The upload's own answer says what went wrong.
      }
    }
  };
  void ask();
  try {
    return await fetch(`${base}${path}`, {
      method: "POST",
      body: form,
      signal,
      headers: { "x-job-id": id },
    });
  } finally {
    answered = true;
  }
}
