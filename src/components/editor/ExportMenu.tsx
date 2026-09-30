import { useId, useRef, useState } from "react";
import { ChevronDown, Download, FileBox, FileDown, FileText } from "lucide-react";
import { CustomButton } from "@/components/shared/CustomButton";
import { cx } from "@/components/shared/cx";
import { Notice } from "@/components/shared/Notice";
import { MenuItem, Popover } from "@/components/shared/Popover";
import { Presence } from "@/components/shared/Presence";
import { useDismiss } from "@/components/shared/useDismiss";
import { toIfc } from "@/geometry/ifc";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { syncConfigFromEnv } from "@/sync/client";
import { syncEnabled } from "@/sync/useSync";
import { buildingFileName, downloadFile } from "@/lib/download";

/**
 * The navy Export button at the top right and its menu: the printable report, the IFC model
 * for the consultant's calculation software, and the PDF from the server when it runs.
 */
/**
 * The server renders the PDF with a headless browser. The hosted server has none, so its
 * build sets VITE_SERVER_PDF=false and the entry goes; the printable report stays.
 */
const serverPdf = syncEnabled && import.meta.env.VITE_SERVER_PDF !== "false";

export function ExportMenu() {
  const t = useT();
  const menuId = useId();
  const building = useEditorStore((s) => s.building);
  const language = useEditorStore((s) => s.language);
  const [open, setOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useDismiss(open, root, () => {
    setOpen(false);
  });

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
    setPdfError(null);
    action();
  };

  return (
    <div ref={root} className="relative">
      <CustomButton
        variant="primary"
        icon={<Download size={15} aria-hidden />}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={pdfBusy || undefined}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {t("export.button")}
        <ChevronDown
          size={14}
          aria-hidden
          className={cx("transition-transform", open && "rotate-180")}
        />
      </CustomButton>
      <Presence show={open} kind="float">
        <Popover
          id={menuId}
          role="menu"
          aria-label={t("export.button")}
          padding="menu"
          className="absolute top-full right-0 mt-1.5 w-60"
        >
          <MenuItem icon={<FileText size={15} />} onClick={run(openReport)}>
            {t("shell.report")}
          </MenuItem>
          <MenuItem icon={<FileBox size={15} />} onClick={run(exportIfc)}>
            {t("bar.exportIfc")}
          </MenuItem>
          {serverPdf && (
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
        </Popover>
      </Presence>
      <Presence value={pdfError} kind="float">
        {(message) => (
          <Popover className="absolute top-full right-0 mt-2 w-72" padding="menu">
            <Notice tone="warning">{message}</Notice>
          </Popover>
        )}
      </Presence>
    </div>
  );
}
