/**
 * The signed in person's notifications (TODO Part 21, CF.3): loaded on signing in and kept
 * live over a socket of their own, so they arrive on every page, not only inside a project.
 */
import { create } from "zustand";
import { accessToken, apiBase } from "@/auth/api";
import { useAuth } from "@/auth/store";
import { openSocket } from "@/sync/client";
import type { SocketLike } from "@/sync/client";
import { inbox, markRead, parseNotice } from "./collab";
import type { Notice } from "./collab";

interface InboxState {
  items: Notice[];
  unread: number;
}

export const useInbox = create<InboxState>(() => ({ items: [], unread: 0 }));

async function load() {
  try {
    useInbox.setState(await inbox());
  } catch {
    // Offline: the bell shows what it had.
  }
}

/** A new or folded item from the server: it moves to the top, counted once while unread. */
function arrived(notice: Notice) {
  const { items, unread } = useInbox.getState();
  const known = items.find((n) => n.id === notice.id);
  const wasUnread = known?.readAt === null;
  useInbox.setState({
    items: [notice, ...items.filter((n) => n.id !== notice.id)],
    unread: unread + (wasUnread ? 0 : 1),
  });
}

export async function readNotices(ids: string[] | "all") {
  const { items, unread } = useInbox.getState();
  const now = new Date().toISOString();
  const hit = (n: Notice) => n.readAt === null && (ids === "all" || ids.includes(n.id));
  const count = items.filter(hit).length;
  if (count === 0) return;
  useInbox.setState({
    items: items.map((n) => (hit(n) ? { ...n, readAt: now } : n)),
    unread: Math.max(0, unread - count),
  });
  await markRead(ids).catch(() => undefined);
}

let socket: SocketLike | null = null;
let started = false;

/** Call once at start: follows signing in and out. */
export function startInbox(): void {
  if (started) return;
  started = true;
  const follow = (signedIn: boolean) => {
    socket?.disconnect();
    socket = null;
    if (!signedIn) {
      useInbox.setState({ items: [], unread: 0 });
      return;
    }
    const base = apiBase();
    if (!base) return;
    void load();
    socket = openSocket(base, accessToken);
    socket.on("notification", (data: unknown) => {
      const notice = parseNotice(data);
      if (notice) arrived(notice);
    });
    // After a lost connection, what came meanwhile.
    socket.on("connect", () => {
      void load();
    });
  };
  useAuth.subscribe((state, prev) => {
    if ((state.status === "signedIn") !== (prev.status === "signedIn")) {
      follow(state.status === "signedIn");
    }
  });
  if (useAuth.getState().status === "signedIn") follow(true);
}
