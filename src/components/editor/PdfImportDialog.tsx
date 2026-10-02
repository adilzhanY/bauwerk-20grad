import { useEffect, useRef, useState } from "react";
import { Check, Square } from "lucide-react";
import { useT } from "@/i18n/useT";
import { aiOffText } from "@/lib/aiHost";
import { formatNumber } from "@/lib/format";
import { pdfPages } from "@/lib/pdfPages";
import { storeysForPages } from "@/lib/storeyFromText";
import { errorText } from "@/lod2/api/errors";
import { readFloorPlan, useFloorplanAvailable } from "@/lod2/api/floorplan";
import type { FloorPlanReading } from "@/lod2/api/floorplan";
import { useEditorStore } from "@/store/building";
import { AiButton } from "@/components/shared/ai/AiButton";
import { AiCard } from "@/components/shared/ai/AiCard";
import { AiScan } from "@/components/shared/ai/AiScan";
import { Card } from "@/components/shared/Card";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { Spinner } from "@/components/shared/Spinner";
import { useElapsed } from "@/components/shared/useElapsed";
import { applyReading } from "./applyReading";

type PageState =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "reading" }
  | { kind: "read"; reading: FloorPlanReading }
  | { kind: "failed"; error: string }
  | { kind: "applied" };

interface Page {
  n: number;
  image: Blob;
  url: string;
  width: number;
  height: number;
  /** The storey it goes to; "" leaves the page out. */
  storeyId: string;
  state: PageState;
}

/**
 * A PDF with the floor plans of the whole building: every page drawn, put on the storey its
 * title names (or the next free one from the bottom up), and each correctable by hand. One
 * button lets the AI read the pages one after another, through the same line for the graphics
 * card as every other AI job; each storey then gets its own walls, doors, rooms and plan.
 */
export function PdfImportDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const t = useT();
  const storeys = useEditorStore((s) => s.building.storeys);
  const footprint = useEditorStore((s) => s.building.footprint);
  const setFloorPlanImage = useEditorStore((s) => s.setFloorPlanImage);
  const available = useFloorplanAvailable();
  const [pages, setPages] = useState<Page[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState<{ startedAt: number; ahead: number } | null>(null);
  const stop = useRef<AbortController | null>(null);
  // The pages' pictures the store took over, which must outlive this dialog.
  const kept = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    const made: string[] = [];
    const keep = kept.current;
    const ids = useEditorStore.getState().building.storeys.map((s) => s.id);
    pdfPages(file)
      .then((drawn) => {
        if (!live) return;
        const assigned = storeysForPages(
          drawn.map((p) => p.text),
          ids,
        );
        setPages(
          drawn.map((p, i) => {
            const url = URL.createObjectURL(p.image);
            made.push(url);
            return {
              n: i + 1,
              image: p.image,
              url,
              width: p.width,
              height: p.height,
              storeyId: assigned[i] ?? "",
              state: { kind: "idle" },
            };
          }),
        );
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      stop.current?.abort();
      for (const url of made) if (!keep.has(url)) URL.revokeObjectURL(url);
    };
  }, [file]);

  const update = (n: number, change: Partial<Page>) => {
    setPages((current) => current?.map((p) => (p.n === n ? { ...p, ...change } : p)) ?? null);
  };
  const toRead = (pages ?? []).filter(
    (p) => p.storeyId && p.state.kind !== "read" && p.state.kind !== "applied",
  );
  const readable = (pages ?? []).filter((p) => p.state.kind === "read");
  const storeyName = (id: string) => storeys.find((s) => s.id === id)?.name ?? "";

  const readAll = async () => {
    const queue = toRead;
    const controller = new AbortController();
    const stopped = () => controller.signal.aborted;
    stop.current = controller;
    for (const page of queue) update(page.n, { state: { kind: "waiting" } });
    setRun({ startedAt: performance.now(), ahead: 0 });
    for (const page of queue) {
      if (stopped()) break;
      update(page.n, { state: { kind: "reading" } });
      try {
        const reading = await readFloorPlan(page.image, footprint, controller.signal, (ahead) => {
          setRun((current) => current && { ...current, ahead });
        });
        update(page.n, { state: { kind: "read", reading } });
      } catch (e) {
        if (stopped()) break;
        update(page.n, { state: { kind: "failed", error: errorText(e, t) } });
      }
    }
    // Pages the stop left waiting go back to how they were.
    setPages(
      (current) =>
        current?.map((p) =>
          p.state.kind === "waiting" || p.state.kind === "reading"
            ? { ...p, state: { kind: "idle" } }
            : p,
        ) ?? null,
    );
    setRun(null);
    stop.current = null;
  };

  const apply = (page: Page) => {
    if (page.state.kind !== "read" || !page.storeyId) return;
    applyReading(page.storeyId, page.state.reading, page.url);
    kept.current.add(page.url);
    update(page.n, { state: { kind: "applied" } });
  };

  /** The pages only as the storeys' floor plan pictures, without reading them. */
  const keepPictures = () => {
    for (const page of pages ?? []) {
      if (!page.storeyId || page.state.kind === "applied") continue;
      setFloorPlanImage(page.storeyId, { url: page.url, width: page.width, height: page.height });
      kept.current.add(page.url);
      update(page.n, { state: { kind: "applied" } });
    }
  };

  const options = [
    { value: "", label: t("pdfImport.skip") },
    ...storeys.map((s) => ({ value: s.id, label: s.name })),
  ];
  const busy = run !== null;
  const done = (pages ?? []).filter(
    (p) => p.state.kind === "read" || p.state.kind === "failed",
  ).length;
  const current = (pages ?? []).find((p) => p.state.kind === "reading");

  return (
    <CustomDialog
      title={t("pdfImport.title")}
      closeLabel={t("shortcuts.close")}
      onClose={onClose}
      width={640}
    >
      <div className="-mx-5 flex max-h-[72vh] flex-col gap-3 overflow-y-auto px-5">
        <Presence show={!pages && !failed}>
          <div className="flex items-center gap-2">
            <Spinner />
            <Hint>{t("pdfImport.loading")}</Hint>
          </div>
        </Presence>
        <Presence show={failed}>
          <Hint error>{t("pdfImport.failed")}</Hint>
        </Presence>
        <Presence value={pages}>
          {(list) => (
            <div className="flex flex-col gap-3">
              <Hint>{t("pdfImport.hint")}</Hint>
              <ul className="flex flex-col gap-2">
                {list.map((page) => (
                  <li key={page.n}>
                    <Card inset className="flex items-center gap-3 p-2">
                      <img
                        src={page.url}
                        alt={t("pdfImport.page", { n: page.n })}
                        className="h-20 w-28 shrink-0 rounded-soft bg-panel object-contain"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <CustomSelect
                          label={t("pdfImport.storey", { n: page.n })}
                          value={page.storeyId}
                          options={options}
                          disabled={busy || page.state.kind === "applied"}
                          onChange={(storeyId) => {
                            update(page.n, { storeyId, state: { kind: "idle" } });
                          }}
                        />
                        <PageStatus page={page} storeyName={storeyName(page.storeyId)} />
                      </div>
                      {page.state.kind === "read" && (
                        <CustomButton
                          variant="quiet"
                          onClick={() => {
                            apply(page);
                          }}
                        >
                          {t("pdfImport.apply")}
                        </CustomButton>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
              <Presence value={run}>
                {(r) => (
                  <Running
                    startedAt={r.startedAt}
                    ahead={r.ahead}
                    page={current?.n ?? 0}
                    done={done}
                    count={done + toRead.length}
                    url={current?.url}
                    onStop={() => {
                      stop.current?.abort();
                    }}
                  />
                )}
              </Presence>
              <Presence show={available === false}>
                <Hint>{aiOffText(t)}</Hint>
              </Presence>
              <div className="flex flex-wrap gap-2">
                {available && (
                  <AiButton
                    disabled={busy || toRead.length === 0}
                    onClick={() => {
                      void readAll();
                    }}
                  >
                    {toRead.length === 1
                      ? t("pdfImport.readOne")
                      : t("pdfImport.readAll", { n: toRead.length })}
                  </AiButton>
                )}
                {readable.length > 1 && (
                  <CustomButton
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      for (const page of readable) apply(page);
                    }}
                  >
                    {t("pdfImport.applyAll")}
                  </CustomButton>
                )}
                <CustomButton
                  variant="quiet"
                  disabled={busy || list.every((p) => !p.storeyId || p.state.kind === "applied")}
                  onClick={keepPictures}
                >
                  {t("pdfImport.picturesOnly")}
                </CustomButton>
              </div>
              {list.every((p) => !p.storeyId) && <Hint>{t("pdfImport.none")}</Hint>}
            </div>
          )}
        </Presence>
      </div>
    </CustomDialog>
  );
}

function PageStatus({ page, storeyName }: { page: Page; storeyName: string }) {
  const t = useT();
  const { state } = page;
  const text =
    state.kind === "waiting"
      ? t("pdfImport.waiting")
      : state.kind === "reading"
        ? t("pdfImport.reading")
        : state.kind === "read"
          ? t("pdfImport.found", {
              walls: state.reading.walls.length,
              doors: state.reading.doors.length,
            })
          : state.kind === "failed"
            ? t("pdfImport.pageFailed", { error: state.error })
            : state.kind === "applied"
              ? t("pdfImport.applied", { storey: storeyName })
              : t("pdfImport.page", { n: page.n });
  return (
    <Hint error={state.kind === "failed"} className="flex items-center gap-1">
      {state.kind === "applied" && <Check size={13} aria-hidden />}
      {text}
    </Hint>
  );
}

/** While the AI reads the pages: the page under the scan, which one, how many are done. */
function Running({
  startedAt,
  ahead,
  page,
  done,
  count,
  url,
  onStop,
}: {
  startedAt: number;
  ahead: number;
  page: number;
  done: number;
  count: number;
  url: string | undefined;
  onStop: () => void;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const seconds = useElapsed(startedAt, undefined);
  return (
    <AiCard
      status="working"
      title={ahead > 0 ? t("ai.queue.title") : t("pdfImport.aiTitle", { page, done, count })}
      meta={`${formatNumber(seconds, language, 1)} s`}
      detail={
        ahead > 0
          ? t(ahead === 1 ? "ai.queue.one" : "ai.queue.many", { n: ahead })
          : t("pdfImport.aiDetail")
      }
      actions={
        <CustomButton variant="quiet" icon={<Square size={13} />} onClick={onStop}>
          {t("pdfImport.stop")}
        </CustomButton>
      }
    >
      {url && (
        <div className="relative max-h-56 overflow-hidden rounded-inner">
          <img src={url} alt="" className="block w-full" />
          <AiScan />
        </div>
      )}
    </AiCard>
  );
}
