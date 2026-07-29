interface IconProps {
  className?: string;
}

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconCart({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2.5 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 8H6" />
    </svg>
  );
}

export function IconBox({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M12 3 21 7.5v9L12 21 3 16.5v-9z" />
      <path d="M3 7.5 12 12l9-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function IconWifiOff({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M5 13a10 10 0 0 1 3.5-2.4" />
      <path d="M12.5 7.5A10 10 0 0 1 19 10" />
      <path d="M2 8.5A15 15 0 0 1 6 5.5" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

export function IconChart({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 20V10" />
      <path d="M11 20V4" />
      <path d="M18 20v-7" />
      <path d="M2.5 20h19" />
    </svg>
  );
}

export function IconBell({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconChefHat({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M6.5 15h11a1 1 0 0 0 1-1.2C17.8 9.5 15 7 12 7s-5.8 2.5-6.5 6.8a1 1 0 0 0 1 1.2z" />
      <path d="M7 21h10" />
      <path d="M8 21v-6" />
      <path d="M16 21v-6" />
    </svg>
  );
}

export function IconPill({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4.93 19.07a5 5 0 0 1 0-7.07l7.07-7.07a5 5 0 0 1 7.07 7.07l-7.07 7.07a5 5 0 0 1-7.07 0z" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

export function IconTruck({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <rect x="1" y="7" width="13" height="9" />
      <path d="M14 10h4l3 3v3h-7z" />
      <circle cx="6" cy="18" r="1.7" />
      <circle cx="17.5" cy="18" r="1.7" />
    </svg>
  );
}

export function IconUsers({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="8.5" r="2.6" />
      <path d="M15.5 14.3c2.6.5 4.5 2.8 4.5 5.7" />
    </svg>
  );
}

export function IconTag({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M20.5 12.5 12.6 20.4a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1 0-2.8L11.5 3.5H19a1.5 1.5 0 0 1 1.5 1.5v7.5z" />
      <circle cx="15.5" cy="8.5" r="1.4" />
    </svg>
  );
}

export function IconUser({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}

export function IconCheck({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconArrowRight({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="M14 6l6 6-6 6" />
    </svg>
  );
}

export function IconStore({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M3 9 4.5 3.5h15L21 9" />
      <path d="M3 9v11h18V9" />
      <path d="M9 20v-6h6v6" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    </svg>
  );
}

export function IconBuilding({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <rect x="7.5" y="6.5" width="2.5" height="2.5" />
      <rect x="14" y="6.5" width="2.5" height="2.5" />
      <rect x="7.5" y="11.5" width="2.5" height="2.5" />
      <rect x="14" y="11.5" width="2.5" height="2.5" />
      <path d="M9.5 21v-5h5v5" />
    </svg>
  );
}

export function IconShield({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M12 3 4.5 5.5v6C4.5 16.7 7.7 20.4 12 21.5c4.3-1.1 7.5-4.8 7.5-10v-6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function IconLayers({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  );
}

export function IconSmartphone({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <line x1="10.5" y1="18.3" x2="13.5" y2="18.3" />
    </svg>
  );
}

export function IconRefreshCw({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M21 8a9 9 0 0 0-15.5-5.3M3 4v5h5" />
      <path d="M3 16a9 9 0 0 0 15.5 5.3M21 20v-5h-5" />
    </svg>
  );
}

export function IconMenu({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export function IconX({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm5.8 14.08c-.24.68-1.4 1.33-1.93 1.4-.5.07-1.06.1-1.7-.11-.4-.13-.9-.29-1.55-.57-2.73-1.18-4.51-3.94-4.65-4.13-.14-.18-1.11-1.48-1.11-2.83s.7-2 .95-2.28c.24-.27.53-.34.71-.34l.5.01c.16.01.38-.06.6.46.24.57.8 1.97.87 2.11.07.14.11.31.02.5-.09.18-.14.3-.27.46-.14.16-.29.36-.41.48-.14.14-.28.29-.12.56.16.28.71 1.18 1.53 1.91 1.05.94 1.94 1.24 2.21 1.38.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.18-.27.36-.22.6-.13.24.09 1.55.73 1.82.86.27.14.44.2.51.31.07.12.07.66-.17 1.35Z" />
    </svg>
  );
}
