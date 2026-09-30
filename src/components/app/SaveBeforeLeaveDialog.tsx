import { useState } from "react";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { useT } from "@/i18n/useT";
import { useLeave } from "@/projects/session";
import type { LeaveChoice } from "@/projects/session";

/**
 * "Save this project?" when unsaved work is about to be left: Save, Don't save, or stay.
 * Asked by projects/session.ts before the app leaves the project or opens other work.
 */
export function SaveBeforeLeaveDialog() {
  const answer = useLeave((s) => s.answer);
  return (
    <Presence value={answer} kind="float">
      {(respond) => <Question respond={respond} />}
    </Presence>
  );
}

function Question({ respond }: { respond: (choice: LeaveChoice) => Promise<boolean> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const choose = (choice: LeaveChoice) => {
    setBusy(true);
    setFailed(false);
    void respond(choice).then((done) => {
      setBusy(false);
      if (!done) setFailed(true);
    });
  };
  return (
    <CustomDialog
      title={t("leave.title")}
      closeLabel={t("common.cancel")}
      onClose={() => {
        choose("cancel");
      }}
    >
      <p className="text-sm leading-relaxed text-ink">{t("leave.body")}</p>
      <Presence show={failed}>
        <Hint error className="mt-2">
          {t("project.saveFailed")}
        </Hint>
      </Presence>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <CustomButton
          variant="danger"
          disabled={busy}
          onClick={() => {
            choose("discard");
          }}
        >
          {t("leave.discard")}
        </CustomButton>
        <CustomButton
          disabled={busy}
          onClick={() => {
            choose("cancel");
          }}
        >
          {t("common.cancel")}
        </CustomButton>
        <CustomButton
          variant="primary"
          loading={busy}
          onClick={() => {
            choose("save");
          }}
        >
          {t("project.save")}
        </CustomButton>
      </div>
    </CustomDialog>
  );
}
