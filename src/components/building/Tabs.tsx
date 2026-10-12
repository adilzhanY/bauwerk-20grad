import { useId } from "react";
import { CustomTabs } from "@/components/shared/CustomTabs";

/** The building page's part tabs: CustomTabs underlined, in one row that scrolls. */
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
  const id = useId();
  return (
    <CustomTabs
      id={id}
      variant="underline"
      label={label}
      value={value}
      tabs={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
      onChange={onChange}
      moreLabel={moreLabel}
    />
  );
}
