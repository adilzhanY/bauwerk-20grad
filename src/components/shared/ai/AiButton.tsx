import { Sparkles } from "lucide-react";
import type { ComponentProps } from "react";
import { CustomButton } from "../CustomButton";

/**
 * The button that starts the AI: the primary button with the sparkles. Every AI entry point
 * on the site is this one, so people learn what it looks like.
 */
export function AiButton(props: Omit<ComponentProps<typeof CustomButton>, "icon" | "variant">) {
  return <CustomButton variant="primary" icon={<Sparkles size={15} aria-hidden />} {...props} />;
}
