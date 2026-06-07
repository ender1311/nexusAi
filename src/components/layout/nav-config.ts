import {
  LayoutDashboard, Bot, Users2, BarChart3, Settings, Radar, Database,
  Play, Workflow, FlaskConical, Sprout, HelpCircle, BookOpen, Mail,
  ScrollText, Search, Boxes, Ruler, type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string; icon: LucideIcon; children: NavItem[] };
export type NavEntry = NavItem | NavGroup;

export function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

export const navTree: NavEntry[] = [
  {
    label: "Dashboard", icon: LayoutDashboard, children: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/control-tower", label: "Control Tower", icon: Radar },
    ],
  },
  { href: "/agents", label: "Agents", icon: Bot },
  {
    label: "Audience", icon: Users2, children: [
      { href: "/audience/search", label: "Search Users", icon: Search },
      { href: "/audience/segments", label: "Segments", icon: Boxes },
      { href: "/audience/sizes", label: "Sizes", icon: Ruler },
    ],
  },
  {
    label: "Content", icon: BookOpen, children: [
      { href: "/messages", label: "Push Library", icon: BookOpen },
      { href: "/email-library", label: "Email Library", icon: Mail },
      { href: "/push-library", label: "Verse Library", icon: ScrollText },
    ],
  },
  {
    label: "Data", icon: Database, children: [
      { href: "/personas", label: "Personas", icon: Users2 },
      { href: "/performance", label: "Performance", icon: BarChart3 },
      { href: "/data-ingest", label: "Data Ingest", icon: Database },
    ],
  },
  {
    label: "About", icon: Sprout, children: [
      { href: "/about", label: "About", icon: Sprout },
      { href: "/architecture", label: "Architecture", icon: Workflow },
      { href: "/demo/deep-dive", label: "Advanced Docs", icon: FlaskConical },
      { href: "/faq", label: "FAQ", icon: HelpCircle },
      { href: "/demo", label: "Demo", icon: Play },
    ],
  },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function flattenItems(tree: NavEntry[]): NavItem[] {
  return tree.flatMap((entry) => (isGroup(entry) ? entry.children : [entry]));
}

export function activeHref(pathname: string, tree: NavEntry[]): string | undefined {
  return flattenItems(tree)
    .filter((item) =>
      item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/"),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function groupLabelForHref(href: string | undefined, tree: NavEntry[]): string | undefined {
  if (!href) return undefined;
  for (const entry of tree) {
    if (isGroup(entry) && entry.children.some((c) => c.href === href)) return entry.label;
  }
  return undefined;
}
