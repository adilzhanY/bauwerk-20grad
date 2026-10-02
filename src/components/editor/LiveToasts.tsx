import { useEffect, useRef, useState } from "react";
import { AtSign, Bell } from "lucide-react";
import { useAuth } from "@/auth/store";
import { useT } from "@/i18n/useT";
import { readNotices, useInbox } from "@/projects/inbox";
import { watchActivity } from "@/sync/activity";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { Presence } from "@/components/shared/Presence";
import { Toast } from "@/components/shared/Toast";
import { MOTION_MS } from "@/components/shared/usePresence";
import { activityToast, mentionToast, pushToast } from "./liveToasts";
import type { LiveToast } from "./liveToasts";
import { selectionOfTarget } from "./noteTarget";

const TICK_MS = 250;

interface Shown extends LiveToast {
  id: number;
  left: number;
  hovered: boolean;
}

/**
 * Short toasts about the others in this project: a mention of this person ("Anna Becker
 * mentioned you on Ground floor, Room 1", with Show to jump to the note), and the big changes
 * they make (a floor plan applied, a facade put on, a version restored). Never about this
 * person's own doing; each closes after a few seconds, but not while the pointer is on it.
 */
export function LiveToasts() {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId);
  const me = useAuth((s) => s.account?.id ?? null);
  const [toasts, setToasts] = useState<Shown[]>([]);
  const nextId = useRef(0);

  const show = (toast: LiveToast | null) => {
    if (!toast) return;
    nextId.current += 1;
    const shown: Shown = { ...toast, id: nextId.current, left: toast.ms, hovered: false };
    setToasts((list) => pushToast(list, shown));
  };

  // Mentions: only items that arrive while the project is open, not the inbox already there.
  useEffect(() => {
    let seen = new Set(useInbox.getState().items.map((n) => n.id + n.createdAt));
    return useInbox.subscribe((state) => {
      const fresh = state.items.filter((n) => !seen.has(n.id + n.createdAt));
      seen = new Set(state.items.map((n) => n.id + n.createdAt));
      const { building } = useEditorStore.getState();
      for (const notice of fresh) show(mentionToast(notice, projectId, building, t));
    });
  }, [projectId, t]);

  // Big changes by others, other tabs of this same person included.
  useEffect(
    () =>
      watchActivity((event) => {
        if (me !== null && event.userId === me) return;
        show(activityToast(event, useEditorStore.getState().building, t));
      }),
    [me, t],
  );

  // One clock for all of them; a hovered toast waits.
  const running = toasts.length > 0;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setToasts((list) =>
        list
          .map((x) => (x.hovered && x.left > 0 ? x : { ...x, left: x.left - TICK_MS }))
          // Gone from the screen first (the exit motion), then from the list.
          .filter((x) => x.left > -MOTION_MS - TICK_MS),
      );
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running]);

  const close = (id: number) => {
    setToasts((list) => list.map((x) => (x.id === id ? { ...x, left: 0, hovered: false } : x)));
  };

  const jump = (toast: Shown) => {
    close(toast.id);
    if (toast.noticeId) void readNotices([toast.noticeId]);
    const store = useEditorStore.getState();
    if (!toast.jump) return;
    if ("storeyId" in toast.jump) {
      store.setActiveStorey(toast.jump.storeyId);
      store.select({ kind: "storey", id: toast.jump.storeyId });
      return;
    }
    const to = selectionOfTarget(store.building, toast.jump.target, store.activeStoreyId);
    if (!to) {
      store.clearSelection();
      return;
    }
    if (to.storeyId) store.setActiveStorey(to.storeyId);
    store.select(to.selection);
  };

  return (
    <>
      {toasts.map((toast) => (
        <Presence key={toast.id} show={toast.left > 0} kind="float">
          <Toast
            tone="info"
            icon={
              toast.noticeId ? <AtSign size={16} aria-hidden /> : <Bell size={16} aria-hidden />
            }
            dismissLabel={t("toast.close")}
            onDismiss={() => {
              close(toast.id);
            }}
            onHover={(hovered) => {
              setToasts((list) => list.map((x) => (x.id === toast.id ? { ...x, hovered } : x)));
            }}
            actions={
              toast.jump && (
                <CustomButton
                  variant="primary"
                  onClick={() => {
                    jump(toast);
                  }}
                >
                  {t("toast.show")}
                </CustomButton>
              )
            }
          >
            <span className="flex flex-col gap-0.5">
              <span>{toast.text}</span>
              {toast.detail && <span className="line-clamp-2 text-muted">“{toast.detail}”</span>}
            </span>
          </Toast>
        </Presence>
      ))}
    </>
  );
}
