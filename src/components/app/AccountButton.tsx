import { useRef, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { MenuItem, Popover } from "@/components/shared/Popover";
import { Presence } from "@/components/shared/Presence";
import { useDismiss } from "@/components/shared/useDismiss";
import { useT } from "@/i18n/useT";
import { fullName, signOut, useAuth } from "@/auth/store";
import { initialsOf } from "@/components/app/initials";
import { loginPath } from "@/app/router";

/** Built without accounts, the bar shows these initials, as it always did. */
const OWNER_INITIALS = "AY";

/**
 * The user at the right of the top bar. Signed in: the initials of the first and last name in
 * the account's colour, with a menu (the full name, the username and Sign out). Signed out:
 * Sign in. Without accounts: the owner's initials.
 */
export function AccountButton() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const account = useAuth((s) => s.account);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useDismiss(open, root, () => {
    setOpen(false);
  });

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
        className="flex h-9 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-ink transition-colors hover:bg-panel-2"
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
        aria-label={t("auth.account", { name: fullName(account) })}
        title={fullName(account)}
        onClick={() => {
          setOpen(!open);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ background: account.color }}
      >
        {initialsOf(account.firstName, account.lastName)}
      </button>
      <Presence show={open} kind="float">
        <Popover role="menu" padding="menu" className="absolute top-11 right-0 w-56">
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-medium text-ink">{fullName(account)}</div>
            <div className="truncate text-xs text-muted">@{account.username}</div>
          </div>
          <MenuItem
            icon={<LogOut size={15} />}
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            {t("auth.signOut")}
          </MenuItem>
        </Popover>
      </Presence>
    </div>
  );
}
