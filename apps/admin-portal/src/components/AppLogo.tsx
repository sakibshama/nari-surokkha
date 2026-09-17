/**
 * AppLogo — the Nari Surokkha logo, embedded as a data URI so it can never
 * 404 in dev or production. Falls back to the flag roundel if the image
 * somehow fails to decode, so the brand spot is never an empty box.
 */
import { useState } from 'react';
import LOGO from '/logo.png';
import FlagRoundel from './FlagRoundel';

interface Props {
  size?: number;
  radius?: number;
  /** Adds a soft elevation shadow (nice on hero banners). */
  shadow?: boolean;
}

export default function AppLogo({ size = 40, radius, shadow = true }: Props) {
  const [failed, setFailed] = useState(false);
  const r = radius ?? Math.round(size * 0.28);

  if (failed) return <FlagRoundel size={size} />;

  return (
    <img
      src={LOGO}
      alt="নারী সুরক্ষা — Nari Surokkha"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: r,
        objectFit: 'cover',
        display: 'block',
        flexShrink: 0,
        // Lift above decorative banner overlays (::before/::after glows).
        position: 'relative',
        zIndex: 2,
        boxShadow: shadow ? '0 4px 16px rgba(0,0,0,0.30)' : undefined,
      }}
    />
  );
}
