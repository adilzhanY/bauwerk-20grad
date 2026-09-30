import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { useRef } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "@/components/shared/cx";

/**
 * Underlined tabs in one scrolling row, with an arrow that scrolls further when there are
 * more than fit, as for a building of many parts.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  moreLabel,
}: {
  label: string;
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  moreLabel: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  return (
    <div className="relative flex items-end border-b border-line">
      <div
        ref={row}
        role="tablist"
        aria-label={label}
        className="flex min-w-0 flex-1 gap-8 overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === value}
            onClick={() => {
              onChange(tab.id);
            }}
            className={cx(
              "-mb-px shrink-0 border-b-2 pb-3 text-[15px] whitespace-nowrap transition-colors",
              tab.id === value
                ? "border-ink font-medium text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <CustomIconButton
        label={moreLabel}
        size="xs"
        className="mb-3 ml-2"
        onClick={() => row.current?.scrollBy({ left: 160, behavior: "smooth" })}
      >
        <ChevronRight size={16} aria-hidden />
      </CustomIconButton>
    </div>
  );
}
