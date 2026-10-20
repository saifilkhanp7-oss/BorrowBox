// Simple line icons (24px grid, currentColor)
const I = ({ d, size = 20, fill = 'none', sw = 1.9, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {d ? <path d={d} /> : children}
  </svg>
);

export const HomeIcon = (p) => <I {...p} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />;
export const BoxIcon = (p) => <I {...p}><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="m3 7.5 9 4.5 9-4.5M12 12v9" /></I>;
export const SearchIcon = (p) => <I {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></I>;
export const HandIcon = (p) => <I {...p} d="M7 11V6a1.5 1.5 0 0 1 3 0v4m0-5.5a1.5 1.5 0 0 1 3 0V10m0-4a1.5 1.5 0 0 1 3 0v5m0-3a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L3.3 13a1.6 1.6 0 0 1 2.6-1.8L7 12.5" />;
export const ShelfIcon = (p) => <I {...p}><path d="M4 3v18M20 3v18M4 9h16M4 15h16M4 21h16" /><path d="M8 9V6h3v3M14 15v-4h3v4" /></I>;
export const MenuIcon = (p) => <I {...p} d="M4 6h16M4 12h16M4 18h16" />;
export const BellIcon = (p) => <I {...p}><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" /><path d="M10 20a2.2 2.2 0 0 0 4 0" /></I>;
export const SunIcon = (p) => <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></I>;
export const MoonIcon = (p) => <I {...p} d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5" />;
export const PlusIcon = (p) => <I {...p} d="M12 5v14M5 12h14" />;
export const BackIcon = (p) => <I {...p} d="M15 18 9 12l6-6" />;
export const ChevronIcon = (p) => <I {...p} d="m9 18 6-6-6-6" />;
export const ChevronDownIcon = (p) => <I {...p} d="m6 9 6 6 6-6" />;
export const CameraIcon = (p) => <I {...p}><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1" /><circle cx="12" cy="13.5" r="3.5" /></I>;
export const CheckIcon = (p) => <I {...p} d="M5 12.5 10 17 19 7" />;
export const XIcon = (p) => <I {...p} d="M6 6l12 12M18 6 6 18" />;
export const ChatIcon = (p) => <I {...p} d="M4 5h16v11H9l-5 4z" />;
export const CalendarIcon = (p) => <I {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></I>;
export const QrIcon = (p) => <I {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></I>;
export const ScanIcon = (p) => <I {...p} d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />;
export const GiftIcon = (p) => <I {...p}><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8c-1.5-3-5-3.5-5-1.2C7 8 9 8 12 8c3 0 5 0 5-1.2C17 4.5 13.5 5 12 8" /></I>;
export const MegaphoneIcon = (p) => <I {...p} d="M4 10v4h3l7 4V6L7 10zM17 9a4 4 0 0 1 0 6" />;
export const SparkIcon = (p) => <I {...p} d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />;
export const UsersIcon = (p) => <I {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6" /></I>;
export const SettingsIcon = (p) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1" /></I>;
export const ShieldIcon = (p) => <I {...p} d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" />;
export const AlertIcon = (p) => <I {...p}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17v.01" /></I>;
export const ClockIcon = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>;
export const TrashIcon = (p) => <I {...p} d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />;
export const EditIcon = (p) => <I {...p} d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />;
export const LogoutIcon = (p) => <I {...p} d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" />;
export const CopyIcon = (p) => <I {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></I>;
export const HeartIcon = (p) => <I {...p} d="M12 20s-7.5-4.6-9-9.5C2 7 4.5 4 7.6 4c2 0 3.4 1 4.4 2.5C13 5 14.4 4 16.4 4 19.5 4 22 7 21 10.5 19.5 15.4 12 20 12 20" />;
export const SendIcon = (p) => <I {...p} d="M4 12 20 4l-6 16-3-7z" />;
export const PauseIcon = (p) => <I {...p} d="M8 5v14M16 5v14" />;
export const ShareIcon = (p) => <I {...p}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" /></I>;
export const ListIcon = (p) => <I {...p} d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" sw={2.2} />;
export const LogoMark = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="16" fill="var(--accent)" />
    <path d="M14 26 32 17l18 9v18L32 53 14 44Z" fill="var(--sun)" />
    <path d="M14 26l18 9 18-9M32 35v18M23 21.5l18 9" fill="none" stroke="var(--accent-deep)" strokeWidth="3.5" strokeLinejoin="round" />
  </svg>
);
