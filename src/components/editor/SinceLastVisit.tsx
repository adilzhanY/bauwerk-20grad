import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/auth/store";
import { useT } from "@/i18n/useT";
import { fetchVersions } from "@/sync/useSync";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { Presence } from "@/components/shared/Presence";
import { Toast } from "@/components/shared/Toast";
import { changeText } from "./changeText";
import { CompareDialog } from "./CompareDialog";
import { sinceLastVisit } from "./sinceLastVisit";
import type { SinceEntry } from "./sinceLastVisit";

/**
 * On opening a project: what the others did since this person was last in it (TODO Part 21,
 * CG.4), with Compare to see the building then beside now.
 */
export function SinceLastVisit() {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId);
  const lastSeenAt = useEditorStore((s) => s.lastSeenAt);
  const setLastSeenAt = useEditorStore((s) => s.setLastSeenAt);
  const me = useAuth((s) => s.account?.id ?? null);
  const [news, setNews] = useState<{ people: SinceEntry[]; from: number } | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    if (!projectId || !lastSeenAt) return;
    let live = true;
    void fetchVersions().then((entries) => {
      if (live) setNews(sinceLastVisit(entries, lastSeenAt, me));
    });
    return () => {
      live = false;
    };
  }, [projectId, lastSeenAt, me]);

  const dismiss = () => {
    setNews(null);
    setLastSeenAt(null);
  };

  return (
    <>
      <Presence value={news} kind="float">
        {(n) => (
          <Toast
            tone="info"
            icon={<Sparkles size={16} aria-hidden />}
            dismissLabel={t("since.dismiss")}
            onDismiss={dismiss}
            actions={
              <CustomButton
                variant="primary"
                onClick={() => {
                  setComparing(true);
                }}
              >
                {t("since.compare")}
              </CustomButton>
            }
          >
            <span className="flex flex-col gap-0.5">
              <b className="font-semibold">{t("since.title")}</b>
              {n.people.map((p) => (
                <span key={p.actor}>
                  {t("since.person", {
                    name: p.actor,
                    what: changeText(p.summary, t, 2) || t("since.someChanges", { n: p.versions }),
                  })}
                </span>
              ))}
            </span>
          </Toast>
        )}
      </Presence>
      <Presence value={comparing && news ? news : null} kind="float">
        {(n) => (
          <CompareDialog
            version={n.from}
            name={t("since.title")}
            onClose={() => {
              setComparing(false);
              dismiss();
            }}
          />
        )}
      </Presence>
    </>
  );
}
