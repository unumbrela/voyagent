/**
 * 全站图标词汇表：集中 re-export lucide-react，替换 emoji。
 * 只在这里增删图标，页面一律从 "@/app/ui/icons" 导入。
 */
export {
  // 导航 / 品牌
  Compass,
  Map,
  MapPin,
  Navigation,
  Globe2,
  // 行程结构
  CalendarDays,
  CalendarCheck2,
  Clock,
  Ticket,
  Route,
  // 条目类别
  Landmark,
  Utensils,
  BedDouble,
  TrainFront,
  Plane,
  Footprints,
  CarTaxiFront,
  // 面板 / 功能
  Wallet,
  Luggage,
  SlidersHorizontal,
  MessageCircle,
  Microscope,
  Bookmark,
  Share2,
  Link2,
  ExternalLink,
  Printer,
  Download,
  CloudSun,
  CloudRain,
  Sun,
  Brain,
  Sparkles,
  Bot,
  // 操作
  Plus,
  X,
  Check,
  CheckCircle2,
  AlertTriangle,
  Info,
  Search,
  Send,
  Mic,
  MicOff,
  Keyboard,
  Trash2,
  GripVertical,
  Undo2,
  RefreshCw,
  Pencil,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  ArrowUpRight,
  Star,
  Eye,
  EyeOff,
  LogOut,
  User,
  Loader2,
  BadgeCheck,
  ShieldCheck,
  ShieldAlert,
  Lightbulb,
  Coins,
  Receipt,
} from "lucide-react";

import {
  Landmark,
  Utensils,
  BedDouble,
  TrainFront,
  MapPin,
  type LucideIcon,
} from "lucide-react";

/** 条目类别 → 图标（与 lib/budget.ts KIND_META 的类别对齐） */
export const KIND_ICONS: Record<string, LucideIcon> = {
  activity: Landmark,
  food: Utensils,
  rest: BedDouble,
  transit: TrainFront,
  other: MapPin,
};

export type { LucideIcon };
