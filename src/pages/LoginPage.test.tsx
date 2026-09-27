import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const signUp = vi.fn(() => Promise.resolve(null));
const signIn = vi.fn(() => Promise.resolve("auth.error.credentials"));
let status: "off" | "signedOut" = "signedOut";

vi.mock("@/auth/store", () => ({
  signIn: (...args: unknown[]) => signIn(...(args as [])),
  signUp: (...args: unknown[]) => signUp(...(args as [])),
  useAuth: (select: (s: { status: string }) => unknown) => select({ status }),
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubEnv("VITE_API_URL", "/collab");
  signUp.mockClear();
  signIn.mockClear();
  status = "signedOut";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function page() {
  vi.resetModules();
  const { LoginPage } = await import("./LoginPage");
  render(<LoginPage />);
}

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

describe("LoginPage", () => {
  it("says so when the app was built without accounts", async () => {
    status = "off";
    await page();
    expect(screen.getByText(/has no accounts/)).toBeTruthy();
  });

  it("shows why sign in failed", async () => {
    await page();
    type("Email", "ada@example.com");
    type("Password", "wrong-one");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await Promise.resolve();
    });
    expect(signIn).toHaveBeenCalledWith("ada@example.com", "wrong-one");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Email or password is not right.")).toBeTruthy();
  });

  it("creates the account only with a free, allowed username and a long enough password", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify({ valid: true, available: !url.includes("taken") }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await page();
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    type("Email", "ada@example.com");
    type("Password", "short");
    expect(screen.getByText("The password needs at least 8 characters.")).toBeTruthy();
    type("Password", "long-enough");
    type("Username", "a b");
    expect(screen.getByLabelText("Username").getAttribute("aria-invalid")).toBe("true");
    type("Username", "taken_name");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(await screen.findByText("This username is taken. Try another one.")).toBeTruthy();
    const create = () => screen.getByRole("button", { name: "Create account" });
    expect(create().hasAttribute("disabled")).toBe(true);
    type("Username", "ada_l");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fetchMock).toHaveBeenCalledWith("/collab/auth/username-available?name=ada_l");
    await act(async () => {
      fireEvent.click(create());
      await Promise.resolve();
    });
    expect(signUp).toHaveBeenCalledWith("ada@example.com", "long-enough", "ada_l", true);
  });
});
