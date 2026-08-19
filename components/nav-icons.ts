import {
  Banknote,
  Car,
  CalendarDays,
  CreditCard,
  FileSignature,
  FileText,
  History,
  Image,
  LayoutGrid,
  ListChecks,
  MessageCircle,
  Route,
  Settings,
  Sparkles,
  Ticket,
  TrendingUp,
  Upload,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

/**
 * Nav icons, addressed by name.
 *
 * The name is the part that crosses the server/client boundary, not the
 * component. AppShell is a server component and the two navs are client
 * components, so handing them an icon *component* means putting a
 * function in a prop -- which React cannot serialise, and which fails
 * at runtime with a digest rather than at build time with an error.
 * This app has shipped that exact bug once before, when i18n getters
 * were passed the same way.
 *
 * A string survives the boundary. The lookup happens on the client,
 * where the components already live in the bundle.
 */
export const NAV_ICONS = {
  dashboard: LayoutGrid,
  assistant: Sparkles,
  messages: MessageCircle,
  calendar: CalendarDays,
  orders: Route,
  imports: Upload,
  vehicles: Car,
  vehicleRoi: TrendingUp,
  owners: UsersRound,
  directBooking: Ticket,
  staffSchedule: ListChecks,
  contracts: FileSignature,
  photos: Image,
  documents: FileText,
  activity: History,
  billing: CreditCard,
  payouts: Banknote,
  accountSettings: Settings,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;
