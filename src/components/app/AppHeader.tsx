import { FolderOpen, Map } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/shared/cx";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { AccountButton } from "@/components/app/AccountButton";
import { NotificationBell } from "@/components/app/NotificationBell";
import { Logo } from "@/components/app/Logo";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { useRouter } from "@/app/router";

/**
 * The white bar across the top of every page: the mark and the two places (the projects and
 * the map) on the left, then whatever the page puts there, and on the right the page's actions, the
 * language, the theme and the user.
 */
export function AppHeader({
  startSlot,
  endSlot,
}: {
  startSlot: (node: HTMLDivElement | null) => void;
  endSlot: (node: HTMLDivElement | null) => void;
}) {
  const t = useT();
  const route = useRouter((s) => s.route);
  const navigate = useRouter((s) => s.navigate);
  const language = useEditorStore((s) => s.language);
  const setLanguage = useEditorStore((s) => s.setLanguage);

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-paper pr-3 pl-4">
      <button
        type="button"
        aria-label={t("shell.home")}
        title={t("shell.home")}
        onClick={() => {
          navigate({ page: "projects" }, { query: "" });
        }}
        className="mr-2 text-select"
      >
        <Logo size={24} />
      </button>
      <nav aria-label={t("shell.nav")} className="flex items-center gap-1">
        <NavButton
          label={t("shell.projects")}
          active={route.page === "projects"}
          onClick={() => {
            navigate({ page: "projects" }, { query: "" });
          }}
        >
          <FolderOpen size={15} aria-hidden />
        </NavButton>
        <NavButton
          label={t("shell.map")}
          active={route.page === "map"}
          onClick={() => {
            navigate({ page: "map" }, { query: "" });
          }}
        >
          <Map size={15} aria-hidden />
        </NavButton>
      </nav>
      <span aria-hidden className="mx-2 h-6 w-px bg-line" />
      <div ref={startSlot} className="flex min-w-0 flex-1 items-center gap-3" />
      <div ref={endSlot} className="flex shrink-0 items-center gap-2" />
      <button
        type="button"
        aria-label={t("settings.language")}
        title={t("settings.language")}
        onClick={() => {
          setLanguage(language === "de" ? "en" : "de");
        }}
        className="flex h-9 items-center rounded-control px-2.5 font-num text-xs font-medium text-muted transition-colors hover:bg-panel hover:text-ink"
      >
        {language === "de" ? "DE" : "EN"}
      </button>
      <ThemeToggle />
      <NotificationBell />
      <AccountButton />
    </header>
  );
}

function NavButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cx(
        "flex h-9 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium transition-colors",
        active ? "bg-panel-2 text-ink" : "text-muted hover:bg-panel hover:text-ink",
      )}
    >
      {children}
      {label}
    </button>
  );
}
