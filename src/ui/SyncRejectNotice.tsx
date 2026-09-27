import { X } from "lucide-react";
import type { Rejection } from "@/sync/client";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { CustomIconButton } from "@/components/CustomIconButton";

/** The reason in plain words, for the checks two people most often trip together. */
function reasonKey(rejection: Rejection): MessageKey {
  switch (rejection.error?.code) {
    case "openingsOverlap":
      return "sync.rejected.overlap";
    case "openingOutsideWall":
    case "wallIndexOutOfRange":
      return "sync.rejected.wall";
    case "roomAreaMismatch":
    case "roomOutsideFootprint":
      return "sync.rejected.rooms";
    default:
      return "sync.rejected.other";
  }
}

/**
 * Tells the user the server took back their last edit, because together with an edit
 * someone made at the same moment it would have broken the building.
 */
export function SyncRejectNotice({
  rejection,
  onDismiss,
}: {
  rejection: Rejection;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="pointer-events-auto absolute top-16 left-1/2 z-10 flex max-w-[36rem] -translate-x-1/2 items-center gap-2 rounded-control border border-mark bg-mark-soft px-4 py-1.5 text-sm text-mark shadow-float"
    >
      <span>{t("sync.rejected", { reason: t(reasonKey(rejection)) })}</span>
      <CustomIconButton label={t("linkImport.dismiss")} size="sm" onClick={onDismiss}>
        <X size={14} aria-hidden />
      </CustomIconButton>
    </div>
  );
}
