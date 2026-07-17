/**
 * National flag roundel — the bottle-green field with the red disc of
 * the flag of Bangladesh. Used across the portal as the government emblem.
 */
export default function FlagRoundel({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="9" fill="#006a4e" />
      <circle cx="18" cy="20" r="9.5" fill="#f42a41" />
      <rect x="1" y="1" width="38" height="38" rx="9" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" />
    </svg>
  );
}
