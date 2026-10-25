import type { ReactNode } from "react";

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const MenuIcon = () => <Svg><path d="M4 6h16M4 12h16M4 18h10" /></Svg>;
export const ChevronLeft = () => <Svg><path d="m15 6-6 6 6 6" /></Svg>;
export const ChevronRight = () => <Svg><path d="m9 6 6 6-6 6" /></Svg>;
export const ChatIcon = () => <Svg><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" /></Svg>;
export const SendIcon = () => <Svg><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const AlertIcon = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></Svg>;
export const CloseIcon = () => <Svg size={14}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const DownloadIcon = () => <Svg><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Svg>;
export const CheckCircle = () => <Svg><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></Svg>;
export const CurrentDot = () => <Svg><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" fill="currentColor" /></Svg>;
export const HollowCircle = () => <Svg><circle cx="12" cy="12" r="9" /></Svg>;
