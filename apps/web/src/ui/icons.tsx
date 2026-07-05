/** Minimal 20px stroke icon set matching the design's soft, rounded look. */
type IconProps = { size?: number; className?: string };

function base(props: IconProps) {
  return {
    width: props.size ?? 20,
    height: props.size ?? 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: props.className,
  };
}

export const IconHelp = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.3 9.2a2.8 2.8 0 1 1 3.9 3.1c-.8.4-1.2 1-1.2 1.9" />
    <circle cx="12" cy="17.3" r="0.4" fill="currentColor" />
  </svg>
);
export const IconList = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="0.6" fill="currentColor" />
    <circle cx="4" cy="12" r="0.6" fill="currentColor" />
    <circle cx="4" cy="18" r="0.6" fill="currentColor" />
  </svg>
);
export const IconBook = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 19V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5V19Z" />
    <path d="M4 19a2.5 2.5 0 0 1 2.5-2.5H19" />
  </svg>
);
export const IconGear = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.4M12 18.8v2.4M4.2 12H1.8m20.4 0h-2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
  </svg>
);
export const IconInbox = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 13.5 5.4 5.8A2 2 0 0 1 7.3 4.4h9.4a2 2 0 0 1 1.9 1.4L21 13.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4.5Z" />
    <path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" />
  </svg>
);
export const IconCheckBadge = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l2.2 1.6 2.7-.3 1 2.5 2.5 1-.3 2.7L21.7 12l-1.6 2.2.3 2.7-2.5 1-1 2.5-2.7-.3L12 21.7l-2.2-1.6-2.7.3-1-2.5-2.5-1 .3-2.7L2.3 12l1.6-2.2-.3-2.7 2.5-1 1-2.5 2.7.3L12 3Z" />
    <path d="m9 12.2 2 2 4-4.2" />
  </svg>
);
export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.8-3.8" />
  </svg>
);
export const IconBriefcase = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.8h18" />
  </svg>
);
export const IconChart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20V4M4 20h16" />
    <path d="m7.5 14 3.5-4 3 2.5 4.5-5.5" />
  </svg>
);
export const IconUsers = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c.6-3 2.9-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
    <path d="M16 5.7a3.2 3.2 0 0 1 0 5.6M18 15.2c1.5.7 2.5 2 2.9 4" />
  </svg>
);
export const IconPlug = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V8ZM12 16v5" />
  </svg>
);
export const IconBell = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4a6 6 0 0 1 6 6v3.2l1.5 2.8H4.5L6 13.2V10a6 6 0 0 1 6-6Z" />
    <path d="M9.8 19a2.3 2.3 0 0 0 4.4 0" />
  </svg>
);
export const IconBack = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m14.5 6-6 6 6 6" />
  </svg>
);
export const IconSend = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 19V6M6.5 11 12 5.5 17.5 11" />
  </svg>
);
export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconCamera = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.4-2h5.8l1.4 2h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
    <circle cx="12" cy="12.3" r="3.2" />
  </svg>
);
export const IconMic = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9.2" y="3.5" width="5.6" height="10" rx="2.8" />
    <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21" />
  </svg>
);
export const IconPaperclip = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-7.7 7.7a1.7 1.7 0 0 1-2.4-2.4l7.2-7.2" />
  </svg>
);
export const IconSparkle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4.5 13.6 10 19 11.5 13.6 13 12 18.5 10.4 13 5 11.5 10.4 10 12 4.5Z" />
    <path d="M18.5 4v3M17 5.5h3" />
  </svg>
);
export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconChevron = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);
export const IconTerminal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 7 4 4-4 4M11 16h8" />
  </svg>
);
export const IconQr = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
    <path d="M13.5 13.5h2.8v2.8h-2.8zM17.2 17.2H20V20h-2.8z" />
  </svg>
);
export const IconMail = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="m4.5 7.5 7.5 5.7 7.5-5.7" />
  </svg>
);
export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 7h14M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M7 7l1 12.2A1.8 1.8 0 0 0 9.8 21h4.4a1.8 1.8 0 0 0 1.8-1.8L17 7" />
  </svg>
);
export const IconEdit = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20Z" />
    <path d="m14.5 6.5 3 3" />
  </svg>
);
export const IconDots = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="12" r="0.9" fill="currentColor" />
    <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    <circle cx="18.5" cy="12" r="0.9" fill="currentColor" />
  </svg>
);
export const IconMerge = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="6" r="2.2" />
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="12" r="2.2" />
    <path d="M8 7c3 1.5 5 2.7 7.8 4.2M8 17c3-1.5 5-2.7 7.8-4.2" />
  </svg>
);
