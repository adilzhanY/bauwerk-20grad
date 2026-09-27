import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { useT } from "@/i18n/useT";
import { signOut, useAuth } from "@/auth/store";
import { initialsOf } from "./initials";
import { loginPath } from "./router";

/** Built without accounts, the bar shows these initials, as it always did. */
const OWNER_INITIALS = "AY";

/**
 * The user at the right of the top bar. Signed in: the initials in the account's colour, with a
 * menu (the username and Sign out). Signed out: Sign in. Without accounts: the owner's initials.
 */
export function AccountButton() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const account = useAuth((s) => s.account);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "off" || status === "loading") {
    return (
      <span
        role="img"
        aria-label={t("shell.user")}
        title={t("shell.user")}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-select-strong text-xs font-semibold text-white"
      >
        {status === "off" ? OWNER_INITIALS : ""}
      </span>
    );
  }

  if (!account) {
    return (
      <a
        href={loginPath()}
        className="flex h-9 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-ink transition-colors hover:bg-panel"
      >
        <LogIn size={15} aria-hidden />
        {t("auth.signIn")}
      </a>
    );
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("auth.account", { name: account.username })}
        title={account.username}
        onClick={() => {
          setOpen(!open);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ background: account.color }}
      >
        {initialsOf(account.username)}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-11 right-0 z-30 w-56 rounded-card border border-line bg-paper p-1.5 shadow-float"
        >
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-medium text-ink">{account.username}</div>
            <div className="truncate text-xs text-muted">{account.email}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-sm text-ink hover:bg-panel"
          >
            <LogOut size={15} aria-hidden />
            {t("auth.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
