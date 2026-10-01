import type { ReactNode } from "react";

/** A message in the middle of an empty view: a title, a line and maybe a few buttons. */
export function Centered({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-paper p-8 text-center">
      <h1 className="font-display text-title font-semibold text-ink">{title}</h1>
      <p className="max-w-md text-base text-muted">{body}</p>
      {children}
    </div>
  );
}
