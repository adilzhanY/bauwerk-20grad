import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The menu as a build with a collaboration server loads it, with the PDF flag as given. */
async function openMenu(serverPdf: string | undefined) {
  vi.stubEnv("VITE_API_URL", "/collab");
  if (serverPdf !== undefined) vi.stubEnv("VITE_SERVER_PDF", serverPdf);
  vi.resetModules();
  const { ExportMenu } = await import("@/components/editor/ExportMenu");
  render(<ExportMenu />);
  fireEvent.click(screen.getByRole("button", { name: /Export/ }));
}

describe("ExportMenu", () => {
  it("offers the server PDF when the server can print it", async () => {
    await openMenu(undefined);
    expect(screen.queryByText("Download PDF")).toBeTruthy();
  });

  it("leaves it out on a server without a browser, and keeps the printable report", async () => {
    await openMenu("false");
    expect(screen.queryByText("Download PDF")).toBeNull();
    expect(screen.getByText("Export IFC")).toBeTruthy();
  });
});
