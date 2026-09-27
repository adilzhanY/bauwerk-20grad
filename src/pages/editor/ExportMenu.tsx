import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Download, FileBox, FileDown, FileText } from "lucide-react";
import { cx } from "@/components/cx";
import { toIfc } from "@/geometry/ifc";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { syncConfigFromEnv } from "@/sync/client";
import { syncEnabled } from "@/sync/useSync";
import { buildingFileName, downloadFile } from "@/ui/download";

/**
 * The navy Export button at the top right and its menu: the printable report, the IFC model
 * for the consultant's calculation software, and the PDF from the server when it runs.
 */
export function ExportMenu() {
  const t = useT();
  const menuId = useId();
  const building = useEditorStore((s) => s.building);
  const language = useEditorStore((s) => s.language);
  const [open, setOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openReport = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("print", "1");
    window.open(url.toString(), "_blank", "noopener");
  };

  const exportIfc = () => {
    const name = buildingFileName(building.name, "ifc");
    downloadFile(toIfc(building, { fileName: name }), name, "application/x-step");
  };

  const downloadPdf = async () => {
    const cfg = syncConfigFromEnv();
    if (!cfg) return;
    setPdfBusy(true);
    try {
      const res = await fetch(`${cfg.apiUrl}/reports?lang=${language}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ building }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      downloadFile(blob, buildingFileName(building.name, "pdf"), "application/pdf");
      setPdfError(null);
    } catch (e) {
      setPdfError(t("bar.pdfFailed", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setPdfBusy(false);
    }
  };

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={pdfBusy || undefined}
        onClick={() => {
          setOpen(!open);
        }}
        className="flex h-9 items-center gap-2 rounded-control bg-select pr-2.5 pl-3 text-sm font-semibold text-white transition-colors hover:bg-select-strong"
      >
        <Download size={15} aria-hidden />
        {t("export.button")}
        <ChevronDown
          size={14}
          aria-hidden
          className={cx("transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("export.button")}
          className="absolute top-full right-0 z-40 mt-1.5 flex w-60 flex-col rounded-inner border border-line bg-paper p-1 shadow-float"
        >
          <MenuItem icon={<FileText size={15} />} onClick={run(openReport)}>
            {t("shell.report")}
          </MenuItem>
          <MenuItem icon={<FileBox size={15} />} onClick={run(exportIfc)}>
            {t("bar.exportIfc")}
          </MenuItem>
          {syncEnabled && (
            <MenuItem
              icon={<FileDown size={15} />}
              disabled={pdfBusy}
              onClick={run(() => {
                void downloadPdf();
              })}
            >
              {t("bar.pdf")}
            </MenuItem>
          )}
        </div>
      )}
      {pdfError && (
        <span
          role="alert"
          className="absolute top-full right-0 z-40 mt-2 w-72 rounded-inner border border-mark bg-mark-soft px-3 py-2 text-xs text-mark shadow-soft"
        >
          {pdfError}
        </span>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  disabled,
  onClick,
  children,
}: {
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 items-center gap-2.5 rounded-soft px-2.5 text-left text-sm text-ink transition-colors hover:bg-panel disabled:opacity-40"
    >
      <span aria-hidden className="text-muted">
        {icon}
      </span>
      {children}
    </button>
  );
}
