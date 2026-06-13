import {
  LayoutDashboard, Bot, Users2, BarChart3, Settings, Radar, Database,
  Play, Workflow, FlaskConical, Sprout, HelpCircle, BookOpen, Mail,
  ScrollText, Search, Boxes, Ruler, Layers, MessageSquare, type LucideIcon,
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
      { href: "/content-card-library", label: "Content Cards", icon: Layers },
      { href: "/slideup-library", label: "Slideups", icon: MessageSquare },
      { href: "/modal-iam-library", label: "Modal IAMs", icon: Layers },
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

// --- Mobile bottom-nav (fan-up popover) view, derived from navTree ---------

export type MobileDivider = { divider: true };
export type MobileItem = NavItem | MobileDivider;
export type MobileTab =
  | { kind: "link"; item: NavItem }
  | { kind: "fan"; label: string; icon: LucideIcon; children: MobileItem[] };

export function isDivider(item: MobileItem): item is MobileDivider {
  return "divider" in item;
}

export function mobileTabLabel(tab: MobileTab): string {
  return tab.kind === "link" ? tab.item.label : tab.label;
}

function groupByLabel(label: string): NavGroup {
  const entry = navTree.find((e) => isGroup(e) && e.label === label);
  if (!entry || !isGroup(entry)) throw new Error(`navTree is missing group "${label}"`);
  return entry;
}

function itemByHref(href: string): NavItem {
  const item = flattenItems(navTree).find((i) => i.href === href);
  if (!item) throw new Error(`navTree is missing item "${href}"`);
  return item;
}

// Five mobile tabs. Four map straight to navTree groups; Agents is a direct
// link. The desktop "Content" group and the standalone Settings item have no
// tab of their own, so they are folded into the About fan (below a divider) to
// keep every page reachable on mobile.
export const mobileTabs: MobileTab[] = [
  { kind: "fan", label: "Dashboard", icon: groupByLabel("Dashboard").icon, children: [...groupByLabel("Dashboard").children] },
  { kind: "link", item: itemByHref("/agents") },
  { kind: "fan", label: "Audience", icon: groupByLabel("Audience").icon, children: [...groupByLabel("Audience").children] },
  { kind: "fan", label: "Data", icon: groupByLabel("Data").icon, children: [...groupByLabel("Data").children] },
  {
    kind: "fan",
    label: "About",
    icon: groupByLabel("About").icon,
    children: [
      ...groupByLabel("About").children,
      { divider: true },
      ...groupByLabel("Content").children,
      itemByHref("/settings"),
    ],
  },
];

export function activeMobileTabLabel(pathname: string): string | undefined {
  const href = activeHref(pathname, navTree);
  if (!href) return undefined;
  for (const tab of mobileTabs) {
    if (tab.kind === "link" && tab.item.href === href) return mobileTabLabel(tab);
    if (tab.kind === "fan" && tab.children.some((c) => !isDivider(c) && c.href === href)) {
      return tab.label;
    }
  }
  return undefined;
}
