import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { SectionLabel } from "@/components/shared/PageTitle";
import { useT } from "@/i18n/useT";
import { HistoryPanel } from "./HistoryPanel";

/**
 * The project's history as a drawer over the properties panel, opened from the clock in the
 * top bar. It stays open while the 3D view shows an older version, so it closes only from
 * its own button or Escape. Mounted in `<Presence kind="float">` inside a `Floating`.
 */
export function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Marked as used, so the editor's own Escape keeps the selection.
      e.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <aside
      aria-label={t("history.title")}
      className="flex h-full min-h-0 flex-col border-l border-line bg-paper shadow-float"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <SectionLabel>{t("history.title")}</SectionLabel>
        <CustomIconButton label={t("shortcuts.close")} size="sm" onClick={onClose}>
          <X size={16} />
        </CustomIconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-5 [scrollbar-gutter:stable]">
        <HistoryPanel />
      </div>
    </aside>
  );
}
