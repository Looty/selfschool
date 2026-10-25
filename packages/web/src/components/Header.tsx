import { Link, NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/courses", label: "Courses", end: false },
  { to: "/attempts", label: "Attempts", end: false },
];

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function Header() {
  return (
    <header className="flex h-14 items-center gap-7 border-b border-border bg-bg px-7">
      <Link to="/" className="flex items-center gap-[9px] text-base font-semibold tracking-tight no-underline">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-primary text-primary-fg">
          <svg {...iconProps} strokeWidth={1.75}>
            <path d="M6 3v18M18 3v18M6 8h12M6 16h12M6 8l12 8" />
          </svg>
        </span>
        Selfschool
      </Link>
      <nav className="flex grow gap-0.5">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `rounded-lg px-3 py-[7px] no-underline ${isActive ? "bg-surface2 font-medium text-text" : "text-text2"}`
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <Link
          to="/settings"
          aria-label="Settings"
          title="Settings"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-border bg-bg text-text2"
        >
          <svg {...iconProps} strokeWidth={1.5}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
