import type { SegmentRule, RuleNode, Group, Condition } from "@/types/segment";

export function emptyRule(): SegmentRule {
  return { kind: "group", join: "AND", children: [] };
}

// Returns a deep-ish clone with the group at `path` transformed by `fn`.
function mapGroupAt(root: SegmentRule, path: number[], fn: (g: Group) => Group): SegmentRule {
  function recurse(node: RuleNode, depth: number): RuleNode {
    if (depth === path.length) {
      if (node.kind !== "group") return node;
      return fn(node);
    }
    if (node.kind !== "group") return node;
    const idx = path[depth];
    const children = node.children.map((child, i) => (i === idx ? recurse(child, depth + 1) : child));
    return { ...node, children };
  }
  return recurse(root, 0) as SegmentRule;
}

export function addChild(root: SegmentRule, path: number[], child: RuleNode): SegmentRule {
  return mapGroupAt(root, path, (g) => ({ ...g, children: [...g.children, child] }));
}

export function removeAt(root: SegmentRule, path: number[]): SegmentRule {
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parentPath, (g) => ({ ...g, children: g.children.filter((_, i) => i !== idx) }));
}

export function updateConditionAt(root: SegmentRule, path: number[], next: Condition): SegmentRule {
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parentPath, (g) => ({
    ...g,
    children: g.children.map((child, i) => (i === idx ? next : child)),
  }));
}

export function setJoinAt(root: SegmentRule, path: number[], join: "AND" | "OR"): SegmentRule {
  return mapGroupAt(root, path, (g) => ({ ...g, join }));
}
