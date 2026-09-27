import type { MessageKey, Params } from "@/i18n";

/** A translation function, as `useT()` returns it. */
export type Translate = (key: MessageKey, params?: Params) => string;

/**
 * An error the user reads, carried as a message key so it is translated where it is shown,
 * not where it was thrown, and follows the language the page is in.
 */
export class UserError extends Error {
  readonly key: MessageKey;
  readonly params: Params | undefined;

  constructor(key: MessageKey, params?: Params) {
    super(key);
    this.name = "UserError";
    this.key = key;
    this.params = params;
  }
}

/** The text to show for any thrown value: translated for a UserError, else its own message. */
export function errorText(error: unknown, t: Translate): string {
  if (error instanceof UserError) return t(error.key, error.params);
  return error instanceof Error ? error.message : String(error);
}
