import { colorFor } from "@/sync/colors";
import { cx } from "./cx";
import { initialsOf } from "./initials";

const SIZE = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
} as const;

/**
 * A person as a round badge with their initials, in their own colour (the same as their
 * cursor and selection everywhere). `status`: a green dot while they are here, faded while
 * away; nothing for people who are not in the project.
 */
export function Avatar({
  userId,
  firstName,
  lastName,
  size = "sm",
  status,
  ring = false,
  className,
}: {
  userId: string;
  firstName: string;
  lastName: string;
  size?: keyof typeof SIZE;
  status?: "here" | "away";
  /** A paper ring, for avatars that overlap in a stack. */
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        SIZE[size],
        ring && "ring-2 ring-paper",
        status === "away" && "opacity-50 grayscale",
        className,
      )}
      style={{ background: colorFor(userId) }}
    >
      {initialsOf(firstName, lastName)}
      {status === "here" && (
        <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-paper" />
      )}
    </span>
  );
}
