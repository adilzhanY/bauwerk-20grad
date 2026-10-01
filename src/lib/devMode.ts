/** Demo and bench helpers (the example buildings) show only with ?dev in the address. */
export function devMode(): boolean {
  return new URLSearchParams(window.location.search).has("dev");
}
