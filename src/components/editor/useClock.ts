import { useEditorStore } from "@/store/building";

/** Clock time in the interface language. */
export function useClock(): (iso: string) => string {
  const language = useEditorStore((s) => s.language);
  const format = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (iso) => format.format(new Date(iso));
}
