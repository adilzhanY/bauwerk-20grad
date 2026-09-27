/** The app mark: three building blocks of different heights, drawn as solid shapes. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden fill="currentColor">
      <path d="M3 25V11l6-3v17H3Z" />
      <path d="M10.5 25V6l7-3.5V25h-7Z" opacity="0.85" />
      <path d="M19 25V9.5l6 2.5v13h-6Z" opacity="0.7" />
    </svg>
  );
}
