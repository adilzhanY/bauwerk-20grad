/**
 * Test environment. jsdom has no matchMedia; this one answers like a browser whose user
 * asked for reduced motion, so enter and exit animations are skipped and a closed dialog
 * or card is gone in the same render, as it is for that user. Every other query is false.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: query.includes("prefers-reduced-motion: reduce"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom has no canvas and prints "Not implemented" for every getContext call. A browser
// without WebGL answers null, which the app already handles (WebGLMissing), so say that.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof HTMLCanvasElement.prototype.getContext;
}
