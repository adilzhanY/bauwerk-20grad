import { useState } from "react";
import { Lock } from "lucide-react";
import { useRouter } from "@/app/router";
import { useT } from "@/i18n/useT";
import { askForAccess } from "@/projects/collab";
import { Card } from "@/components/shared/Card";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomFormInput } from "@/components/shared/CustomFormInput";
import { Hint } from "@/components/shared/Hint";
import { Notice } from "@/components/shared/Notice";
import { Presence } from "@/components/shared/Presence";

/**
 * Opening a project one has no access to (TODO Part 21, CB.6): the address alone lets nobody
 * in, so the person can ask the owner, with an optional message. The owner gets it in their
 * notifications and answers it there or in the Share dialog.
 */
export function NoAccess({ projectId }: { projectId: string }) {
  const t = useT();
  const navigate = useRouter((s) => s.navigate);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");

  const send = async () => {
    setState("busy");
    try {
      await askForAccess(projectId, message.trim());
      setState("sent");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <Card elevation="raised" className="flex w-full max-w-md flex-col gap-4 p-7">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-select-soft text-select">
          <Lock size={20} aria-hidden />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-ink">{t("access.title")}</h1>
          <p className="text-sm text-muted">{t("access.body")}</p>
        </div>
        <Presence show={state !== "sent"} className="flex flex-col gap-3.5">
          <CustomFormInput
            label={t("access.message")}
            value={message}
            onChange={setMessage}
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2">
            <CustomButton
              variant="primary"
              loading={state === "busy"}
              onClick={() => {
                void send();
              }}
            >
              {t("access.request")}
            </CustomButton>
            <CustomButton
              variant="quiet"
              onClick={() => {
                navigate({ page: "projects" }, { query: "" });
              }}
            >
              {t("access.back")}
            </CustomButton>
          </div>
          <Presence show={state === "failed"}>
            <Hint error>{t("access.failed")}</Hint>
          </Presence>
        </Presence>
        <Presence show={state === "sent"}>
          <Notice tone="ok">{t("access.sent")}</Notice>
        </Presence>
      </Card>
    </div>
  );
}
