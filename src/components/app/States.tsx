import { useT } from "@/i18n/useT";
import { Centered } from "@/components/shared/Centered";

export function WebGLMissing() {
  const t = useT();
  return <Centered title={t("webgl.title")} body={t("webgl.body")} />;
}

export function TooNarrow() {
  const t = useT();
  return <Centered title={t("narrow.title")} body={t("narrow.body")} />;
}
