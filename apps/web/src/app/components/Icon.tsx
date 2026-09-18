import {
  ArrowLeft,
  ArrowRight,
  Ban,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  ClockAlert,
  Eye,
  EyeOff,
  FileText,
  Hand,
  History,
  Hourglass,
  Info,
  KanbanSquare,
  LoaderCircle,
  Menu,
  MessageCircle,
  MessageCircleQuestion,
  MessageCircleX,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Table,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

const ICONS = {
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  ban: Ban,
  "book-open": BookOpen,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "circle-check": CircleCheck,
  "circle-slash": CircleSlash,
  "circle-x": CircleX,
  clock: Clock,
  "clock-alert": ClockAlert,
  eye: Eye,
  "eye-off": EyeOff,
  file: FileText,
  hand: Hand,
  history: History,
  hourglass: Hourglass,
  info: Info,
  kanban: KanbanSquare,
  "loader-circle": LoaderCircle,
  menu: Menu,
  message: MessageCircle,
  "message-circle-question": MessageCircleQuestion,
  "message-circle-x": MessageCircleX,
  plus: Plus,
  "refresh-cw": RefreshCw,
  "rotate-ccw": RotateCcw,
  search: Search,
  send: Send,
  "shield-check": ShieldCheck,
  table: Table,
  "triangle-alert": TriangleAlert,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Decorative lucide icon, stroke 2 (DESIGN.md: Icons & bề mặt trình duyệt). */
export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Component = ICONS[name];
  return (
    <Component
      aria-hidden="true"
      width={size}
      height={size}
      strokeWidth={2}
      className={cn("shrink-0", className)}
    />
  );
}
