import { useT } from "@/i18n/useT";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { TOOL_ORDER, toolKey, toolLabel } from "./tools";

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const rows: [string, string][] = [
    [t("shortcuts.undo"), "Ctrl+Z"],
    [t("shortcuts.redo"), "Ctrl+Shift+Z, Ctrl+Y"],
    [t("shortcuts.delete"), "Delete"],
    [t("shortcuts.escape"), "Esc"],
    // The tools in the tool bar's order, then the ones under "More".
    ...TOOL_ORDER.map((tool): [string, string] => [t(toolLabel[tool]), toolKey(tool)]),
    [t("shortcuts.storeys"), "PageUp, PageDown"],
    [t("shortcuts.orbit"), t("shortcuts.orbitKeys")],
  ];
  return (
    <CustomDialog title={t("shortcuts.title")} closeLabel={t("shortcuts.close")} onClose={onClose}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, keys]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-2 text-ink">{label}</td>
              <td className="py-2 text-right font-num text-xs text-muted">{keys}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CustomDialog>
  );
}
