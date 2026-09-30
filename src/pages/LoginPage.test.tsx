import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

type Result = { ok: true } | { ok: false; error: string; fields: Record<string, string> };
const signUp = vi.fn((): Promise<Result> => Promise.resolve({ ok: true }));
const signIn = vi.fn((): Promise<Result> =>
  Promise.resolve({ ok: false, error: "auth.error.credentials", fields: {} }),
);
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
  cleanup();
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

const field = (label: string) => screen.getByLabelText(label, { selector: "input" });
const type = (label: string, value: string) => {
  fireEvent.change(field(label), { target: { value } });
};
const leave = (label: string) => {
  fireEvent.blur(field(label));
};
const submit = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
};

/** The free-name check answers from this list. */
function stubNameCheck(taken: string[] = []) {
  const fetchMock = vi.fn((url: string) => {
    const name = new URL(url, "http://x").searchParams.get("name") ?? "";
    return Promise.resolve(
      new Response(JSON.stringify({ valid: true, available: !taken.includes(name) }), {
        status: 200,
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const waitForNameCheck = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

describe("LoginPage", () => {
  it("says so when there are no accounts", async () => {
    status = "off";
    await page();
    expect(screen.getByText(/has no accounts/)).toBeTruthy();
  });

  it("signs in with username and password, and says so when they are wrong", async () => {
    await page();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    await submit("Sign in");
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your username.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    type("Username", " ada_l ");
    type("Password", "wrong-one");
    await submit("Sign in");
    expect(signIn).toHaveBeenCalledWith({ username: "ada_l", password: "wrong-one" });
    expect(await screen.findByText("Username or password is not right.")).toBeTruthy();
  });

  it("checks each field when the user leaves it, not while typing", async () => {
    stubNameCheck();
    await page();
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    type("First name", "");
    expect(screen.queryByText("Enter your first name.")).toBeNull();
    leave("First name");
    expect(screen.getByText("Enter your first name.")).toBeTruthy();
    type("Last name", "L0velace");
    leave("Last name");
    expect(
      screen.getByText("Letters only, with spaces, hyphens or apostrophes between them."),
    ).toBeTruthy();
    expect(field("Last name").getAttribute("aria-invalid")).toBe("true");
    type("Username", "a b");
    leave("Username");
    expect(screen.getByText("Only letters, digits, _ and -, without spaces.")).toBeTruthy();
  });

  it("ticks off the password rules while typing, and wants the confirmation to match", async () => {
    stubNameCheck();
    await page();
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    const open = () => screen.queryAllByText("still missing").length;
    expect(open()).toBe(5);
    type("Password", "analytical");
    expect(open()).toBe(3); // length and lowercase done
    type("Password", "Analytical-Engine1");
    expect(open()).toBe(0);
    type("Confirm password", "Analytical-Engine2");
    leave("Confirm password");
    expect(screen.getByText("The passwords do not match.")).toBeTruthy();
    type("Confirm password", "Analytical-Engine1");
    expect(screen.queryByText("The passwords do not match.")).toBeNull();
  });

  it("names a taken username before sending anything", async () => {
    const fetchMock = stubNameCheck(["ada_l"]);
    await page();
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    type("Username", "ada_l");
    await waitForNameCheck();
    expect(fetchMock).toHaveBeenCalledWith("/collab/auth/username-available?name=ada_l");
    expect(await screen.findByText("This username is taken. Try another one.")).toBeTruthy();
    type("Username", "ada_2");
    await waitForNameCheck();
    expect(await screen.findByText("This username is free.")).toBeTruthy();
  });

  it("sends nothing while a field breaks a rule, and the whole account once all are right", async () => {
    stubNameCheck();
    await page();
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    type("First name", "Ada");
    type("Last name", "Lovelace");
    type("Username", "ada_l");
    type("Password", "weak");
    type("Confirm password", "weak");
    await submit("Create account");
    expect(signUp).not.toHaveBeenCalled();
    expect(screen.getByText("Some fields need another look.")).toBeTruthy();
    expect(screen.getByText("The password does not meet every rule below.")).toBeTruthy();
    type("Password", "Analytical-Engine1");
    type("Confirm password", "Analytical-Engine1");
    await waitForNameCheck();
    await submit("Create account");
    expect(signUp).toHaveBeenCalledWith({
      firstName: "Ada",
      lastName: "Lovelace",
      username: "ada_l",
      password: "Analytical-Engine1",
      confirmPassword: "Analytical-Engine1",
    });
  });

  it("shows the server's answer under the field it names", async () => {
    stubNameCheck();
    signUp.mockResolvedValueOnce({
      ok: false,
      error: "auth.error.usernameTaken",
      fields: { username: "auth.error.usernameTaken" },
    });
    await page();
    fireEvent.click(screen.getByRole("tab", { name: "Create account" }));
    type("First name", "Ada");
    type("Last name", "Lovelace");
    type("Username", "ada_l");
    type("Password", "Analytical-Engine1");
    type("Confirm password", "Analytical-Engine1");
    await waitForNameCheck();
    await submit("Create account");
    expect(screen.getAllByText("This username is taken. Try another one.")).toHaveLength(2);
    expect(field("Username").getAttribute("aria-invalid")).toBe("true");
  });
});
