import type { Rejection } from "@/sync/client";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { Toast } from "@/components/shared/Toast";

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
    <Toast tone="warning" dismissLabel={t("linkImport.dismiss")} onDismiss={onDismiss}>
      {t("sync.rejected", { reason: t(reasonKey(rejection)) })}
    </Toast>
  );
}
