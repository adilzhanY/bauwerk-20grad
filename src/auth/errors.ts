import type { MessageKey } from "@/i18n";

/** What Supabase Auth answered, as far as the message to show depends on it. */
export interface AuthFailure {
  code?: string;
  status?: number;
  message?: string;
  name?: string;
}

/**
 * The plain message for a failed sign in or sign up. `usernameWasFree` is what the name check
 * said a moment before: a sign up that then fails in the database lost the name in a race.
 */
export function authErrorKey(error: AuthFailure, usernameWasFree = false): MessageKey {
  if (error.name === "AuthRetryableFetchError" || error.status === 0) return "auth.error.network";
  switch (error.code) {
    case "invalid_credentials":
      return "auth.error.credentials";
    case "user_already_exists":
    case "email_exists":
      return "auth.error.emailTaken";
    case "weak_password":
      return "auth.error.weakPassword";
    case "email_address_invalid":
    case "validation_failed":
      return "auth.error.emailInvalid";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "auth.error.tooMany";
  }
  // The profile trigger failed: the username went to someone else just now.
  if (
    /database error saving new user/i.test(error.message ?? "") ||
    error.code === "unexpected_failure"
  )
    return usernameWasFree ? "auth.error.usernameTaken" : "auth.error.other";
  return "auth.error.other";
}
