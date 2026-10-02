import { Presence } from "@/components/shared/Presence";
import { useState } from "react";
import { Share2 } from "lucide-react";
import { ShareDialog } from "./ShareDialog";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { saveProject } from "@/projects/session";
import { lastCreateFailure, syncEnabled } from "@/sync/useSync";
import { loginPath } from "@/app/router";
import { useAuth } from "@/auth/store";

/**
 * Shares the building: makes it a project on the collaboration server the first time, then
 * opens the Share dialog (people, roles, the share link). Shown only when the app was built
 * with a server (not on the static GitHub Pages build).
 */
export function ShareButton() {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Why the project could not be saved, so it could not be shared.
  const [failed, setFailed] = useState<"signIn" | "server" | null>(null);
  if (!syncEnabled) return null;

  const share = async () => {
    setFailed(null);
    // Sharing needs an account; after signing in the user comes back here.
    const auth = useAuth.getState().status;
    // Until the server has said whether there are accounts, a click waits for that.
    if (auth === "loading") return;
    if (auth === "signedOut") {
      window.location.assign(loginPath());
      return;
    }
    // Only a saved project can be shared: sharing an unsaved one saves it.
    if (!projectId) {
      setBusy(true);
      const saved = await saveProject();
      setBusy(false);
      if (!saved) {
        setFailed(lastCreateFailure() ?? "server");
        setOpen(true);
        return;
      }
    }
    setOpen(true);
  };

  return (
    <>
      <CustomButton
        icon={<Share2 size={15} aria-hidden />}
        loading={busy}
        onClick={() => {
          void share();
        }}
      >
        {t("share.button")}
      </CustomButton>
      <Presence show={open} kind="float">
        {failed ? (
          <CustomDialog
            title={t("share.title")}
            closeLabel={t("share.close")}
            onClose={() => {
              setOpen(false);
            }}
          >
            <p className="text-sm text-mark">
              {t(
                failed === "signIn"
                  ? "share.failedSignIn"
                  : import.meta.env.DEV
                    ? "share.failed"
                    : "share.failedServer",
              )}
            </p>
          </CustomDialog>
        ) : (
          <ShareDialog
            onClose={() => {
              setOpen(false);
            }}
          />
        )}
      </Presence>
    </>
  );
}
