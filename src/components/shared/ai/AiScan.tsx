/**
 * The "being worked on" effect over a picture: a light band sweeping down, a slow
 * rotating glow around the edge, and a faint shimmer. All of it sits on top of the image
 * with low opacity, so the photo, the dots and the boxes stay readable underneath.
 */
export function AiScan() {
  return (
    <div className="ai-scan" aria-hidden>
      <div className="ai-scan-glow">
        <div className="ai-scan-glow-spin" />
      </div>
      <div className="ai-scan-shimmer" />
      <div className="ai-scan-band" />
    </div>
  );
}
