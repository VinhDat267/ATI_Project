import {
  ArrowRight,
  ArrowLeft,
  Check,
  Clock3,
  Menu,
  X,
  Plus,
  Send,
  Pencil,
  Grid2X2,
  ShieldCheck,
  LogOut,
  MessageSquare,
  CircleHelp,
  RotateCcw,
  Eye,
  EyeOff,
} from "lucide-react";
const icons = {
  arrow: ArrowRight,
  back: ArrowLeft,
  check: Check,
  clock: Clock3,
  menu: Menu,
  x: X,
  plus: Plus,
  send: Send,
  edit: Pencil,
  grid: Grid2X2,
  shield: ShieldCheck,
  logout: LogOut,
  chat: MessageSquare,
  help: CircleHelp,
  refresh: RotateCcw,
  eye: Eye,
  eyeoff: EyeOff,
};
const serviceAssets: Record<string, string> = {
  github: "/logos/github.svg",
  trello: "/logos/trello.svg",
  slack: "/logos/slack.svg",
  "Google Sheets": "/logos/google-sheets.svg",
  "Google Calendar": "/logos/google-calendar.svg",
  Notion: "/logos/notion.png",
  Telegram: "/logos/telegram.svg",
  Jira: "/logos/jira.svg",
};
export function ServiceLogo({
  name,
  size = 20,
  className = "icon",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  if (!Object.hasOwn(serviceAssets, name))
    return <Grid2X2 className={className} aria-hidden="true" />;
  return (
    <img
      className={`${className} service-logo`}
      src={serviceAssets[name]}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      draggable={false}
    />
  );
}
export function Icon({ name }: { name: string }) {
  if (Object.hasOwn(serviceAssets, name)) return <ServiceLogo name={name} />;
  const Component = icons[name as keyof typeof icons] || Grid2X2;
  return <Component className="icon" aria-hidden="true" />;
}
export function PlanoraMark() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" fill="none">
      <path
        d="M10 25V7h8a6 6 0 0 1 0 12h-8m0 6 13-13"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="25" r="2" fill="currentColor" />
      <circle cx="23" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
export function Brand({ onClick, label = "Planora — trang giới thiệu" }: { onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="brand brand-button"
      onClick={onClick}
      aria-label={label}
    >
      <span className="brand-symbol">
        <PlanoraMark />
      </span>
      <span>
        <span className="brand-word">planora</span>
        <span className="brand-sub" style={{ display: "block" }}>
          Workflow workspace
        </span>
      </span>
    </button>
  );
}
