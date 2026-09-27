import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/CustomButton";
import { CustomDialog } from "@/components/CustomDialog";
import { createProject, openProject, syncEnabled } from "@/sync/useSync";
import { loginPath } from "@/app/router";
import { useAuth } from "@/auth/store";
import { accountsEnabled } from "@/auth/supabase";

/** Loopback names: a link with one of these only opens on this computer. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Shares the building: makes it a project on the collaboration server the first time, then
 * shows the link to send. Anyone who opens the link edits the same building live. Shown only
 * when the app was built with a server (not on the static GitHub Pages build).
 */
export function ShareButton() {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!syncEnabled) return null;

  const share = async () => {
    setFailed(false);
    // Sharing needs an account; after signing in the user comes back here.
    if (accountsEnabled && useAuth.getState().status !== "signedIn") {
      window.location.assign(loginPath());
      return;
    }
    if (!projectId) {
      setBusy(true);
      const id = await createProject().catch(() => null);
      setBusy(false);
      if (!id) {
        setFailed(true);
        setOpen(true);
        return;
      }
      openProject(id);
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
      {open && (
        <ShareDialog
          failed={failed}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function ShareDialog({ failed, onClose }: { failed: boolean; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  // The address bar carries the project once it is shared (useSync's ?project=).
  const link = window.location.href;
  const onlyHere = LOCAL_HOSTS.has(window.location.hostname);
  // The clipboard needs a secure page: localhost or https. On a network address over plain
  // http the link is selected in the box instead, to copy by hand.
  const canCopy = window.isSecureContext;

  return (
    <CustomDialog title={t("share.title")} closeLabel={t("share.close")} onClose={onClose}>
      {failed ? (
        <p className="text-sm text-mark">{t("share.failed")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t("share.body")}</p>
          <div className="rounded-control border border-line bg-panel px-3 py-2 font-num text-xs break-all text-ink select-all">
            {link}
          </div>
          {canCopy && (
            <CustomButton
              variant="primary"
              icon={copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true);
                });
              }}
            >
              {copied ? t("share.copied") : t("share.copy")}
            </CustomButton>
          )}
          {onlyHere && <p className="text-xs text-muted">{t("share.localhost")}</p>}
        </div>
      )}
    </CustomDialog>
  );
}
