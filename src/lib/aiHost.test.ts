import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n";
import type { MessageKey } from "@/i18n";

const t = (key: MessageKey, values?: Record<string, string | number>) =>
  translate("en", key, values);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the message while the AI is off", () => {
  it("names the computer it runs on, when the build names one", async () => {
    vi.stubEnv("VITE_AI_HOST", "Adil's PC");
    const { aiOffText } = await import("./aiHost");
    expect(aiOffText(t)).toBe(
      "The AI runs on Adil's PC, which is turned off right now. Everything else works; try the AI again later.",
    );
  });

  it("says only that it is not running, without a name", async () => {
    vi.stubEnv("VITE_AI_HOST", "");
    const { aiOffText } = await import("./aiHost");
    expect(aiOffText(t)).toBe("The AI is not running right now. Everything else works.");
  });

  it("asks a visitor who is not signed in to sign in, since the AI refuses them, not because it is off", async () => {
    vi.stubEnv("VITE_AI_HOST", "Adil's PC");
    const { useAuth } = await import("@/auth/store");
    useAuth.setState({ status: "signedOut", account: null });
    const { aiOffText } = await import("./aiHost");
    expect(aiOffText(t)).toBe(
      "The AI is for signed in users. Sign in or create a free account to try it.",
    );
  });
});
