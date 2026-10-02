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
import { applyInTurn } from "./applyReading";
import { PlanPreview } from "./PlanPreview";
import { previewMs } from "./previewTiming";

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
 * card as every other AI job, each page's walls drawing in over it as it is read. Applying
 * closes the dialog and puts the storeys on one after another, each with its reveal in the
 * plan view, as a single plan arrives.
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
  // The page just read, its walls drawing in while the next one is read.
  const [shown, setShown] = useState<Shown | null>(null);
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

  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(
      () => {
        setShown(null);
      },
      previewMs(shown.reading) + SHOWN_HOLD_MS,
    );
    return () => {
      clearTimeout(id);
    };
  }, [shown]);

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
        setShown({ n: page.n, url: page.url, reading });
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

  /** Closes the dialog, so the storeys can be seen arriving one after another. */
  const applyAll = () => {
    const items = readable.flatMap((p) =>
      p.state.kind === "read" && p.storeyId
        ? [{ storeyId: p.storeyId, reading: p.state.reading, url: p.url }]
        : [],
    );
    for (const item of items) kept.current.add(item.url);
    onClose();
    applyInTurn(items);
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
                    shown={shown}
                    onStop={() => {
                      stop.current?.abort();
                    }}
                  />
                )}
              </Presence>
              <Presence value={!busy && readable.length > 0 ? readable : null}>
                {(list) => (
                  <Found
                    pages={list}
                    storeyName={storeyName}
                    onApply={applyAll}
                    applyLabel={
                      list.length === 1
                        ? t("floorPlan.apply", { storey: storeyName(list[0]?.storeyId ?? "") })
                        : t("pdfImport.applyAll")
                    }
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

/** How long a page's found walls stay after they have drawn in, before the next page shows. */
const SHOWN_HOLD_MS = 900;

interface Shown {
  n: number;
  url: string;
  reading: FloorPlanReading;
}

/** The pages read: each with its walls and doors drawn over it, and the one way on. */
function Found({
  pages,
  storeyName,
  onApply,
  applyLabel,
}: {
  pages: Page[];
  storeyName: (id: string) => string;
  onApply: () => void;
  applyLabel: string;
}) {
  const t = useT();
  const read = pages.flatMap((p) =>
    p.state.kind === "read" ? [{ page: p, reading: p.state.reading }] : [],
  );
  const walls = read.reduce((n, r) => n + r.reading.walls.length, 0);
  const doors = read.reduce((n, r) => n + r.reading.doors.length, 0);
  return (
    <AiCard
      status="done"
      title={t(read.length === 1 ? "pdfImport.doneOne" : "pdfImport.done", {
        walls,
        doors,
        pages: read.length,
      })}
      bar={false}
      detail={t("pdfImport.doneDetail")}
      actions={
        <CustomButton variant="primary" onClick={onApply}>
          {applyLabel}
        </CustomButton>
      }
    >
      <ul className={read.length === 1 ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
        {read.map(({ page, reading }) => (
          <li key={page.n} className="flex flex-col gap-1">
            <div className="overflow-hidden rounded-inner bg-paper">
              <PlanPreview
                reading={reading}
                url={page.url}
                label={t("pdfImport.previewOf", { n: page.n, storey: storeyName(page.storeyId) })}
                fit
              />
            </div>
            <Hint>
              {storeyName(page.storeyId)}:{" "}
              {t("pdfImport.found", { walls: reading.walls.length, doors: reading.doors.length })}
            </Hint>
          </li>
        ))}
      </ul>
    </AiCard>
  );
}

/**
 * While the AI reads the pages: the page under the scan, which one, how many are done; and
 * as each page is read, its walls and doors drawing in over it before the next page shows.
 */
function Running({
  startedAt,
  ahead,
  page,
  done,
  count,
  url,
  shown,
  onStop,
}: {
  startedAt: number;
  ahead: number;
  page: number;
  done: number;
  count: number;
  url: string | undefined;
  shown: Shown | null;
  onStop: () => void;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const seconds = useElapsed(startedAt, undefined);
  return (
    <AiCard
      status="working"
      title={
        shown
          ? t("pdfImport.pageFound", {
              page: shown.n,
              walls: shown.reading.walls.length,
              doors: shown.reading.doors.length,
            })
          : ahead > 0
            ? t("ai.queue.title")
            : t("pdfImport.aiTitle", { page, done, count })
      }
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
      {shown ? (
        <div key={shown.n} className="overflow-hidden rounded-inner bg-paper">
          <PlanPreview reading={shown.reading} url={shown.url} label={t("floorPlan.preview")} fit />
        </div>
      ) : (
        url && (
          // The whole page, not a strip of it: the plan is often in its lower half.
          <div className="relative mx-auto w-fit overflow-hidden rounded-inner">
            <img src={url} alt="" className="block max-h-80 max-w-full" />
            <AiScan />
          </div>
        )
      )}
    </AiCard>
  );
}
