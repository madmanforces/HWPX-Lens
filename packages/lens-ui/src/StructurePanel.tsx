import {
  alignOutlineSnapshots,
  type BodyTextAnchor,
  type Change,
  type DocumentAnchor,
  type DocumentSnapshot,
  type OutlineChange,
  type ParagraphSnapshot,
} from "@hwpx-lens/lens-core";
import { useEffect, useMemo, useState } from "react";

export type StructureStatus = "unchanged" | "added" | "removed" | "modified";

export interface StructureNode {
  id: string;
  level: number;
  number: string;
  label: string;
  status: StructureStatus;
  originalAnchor?: BodyTextAnchor;
  modifiedAnchor?: BodyTextAnchor;
  changeIds: string[];
  children: StructureNode[];
}

interface FlatStructureNode extends Omit<StructureNode, "children" | "changeIds"> {
  changeIds: string[];
  order: number;
}

export function buildStructureTree(
  original: DocumentSnapshot | undefined,
  modified: DocumentSnapshot | undefined,
  changes: readonly Change[],
): StructureNode[] {
  if (!original && !modified) return [];
  const outlineChanges = changes.filter((change): change is OutlineChange => change.type === "outline");
  const originalChanges = outlineChangeMap(outlineChanges, "original");
  const modifiedChanges = outlineChangeMap(outlineChanges, "modified");
  const alignment = alignOutlineSnapshots(
    original ?? EMPTY_SNAPSHOT,
    modified ?? EMPTY_SNAPSHOT,
  );
  const flat: FlatStructureNode[] = [];

  for (const [order, step] of alignment.entries()) {
    const paragraph = step.modified ?? step.original;
    if (!paragraph) continue;
    const originalAnchor = step.original ? outlineAnchor(step.original) : undefined;
    const modifiedAnchor = step.modified ? outlineAnchor(step.modified) : undefined;
    const change = (step.modified
      ? modifiedChanges.get(paragraphKey(step.modified))
      : undefined) ?? (step.original
      ? originalChanges.get(paragraphKey(step.original))
      : undefined);
    flat.push({
      id: step.modified
        ? `structure-modified-${paragraph.sectionIndex}-${paragraph.paragraphIndex}`
        : `structure-removed-${paragraph.sectionIndex}-${paragraph.paragraphIndex}`,
      level: paragraph.outline.level,
      number: paragraph.outline.number,
      label: paragraph.text,
      status: change ? statusFromChange(change) : statusFromAlignment(step.type),
      originalAnchor,
      modifiedAnchor,
      changeIds: [],
      order,
    });
  }

  flat.sort((left, right) => left.order - right.order || left.level - right.level);
  for (let index = 0; index < flat.length; index += 1) {
    const node = flat[index];
    const useModified = node.modifiedAnchor !== undefined;
    const nextBoundary = flat.slice(index + 1).find((candidate) =>
      candidate.level <= node.level &&
      (useModified ? candidate.modifiedAnchor !== undefined : candidate.originalAnchor !== undefined),
    );
    node.changeIds = changes
      .filter((change) => changeInScope(change, node, nextBoundary))
      .map((change) => change.id);
  }
  return nestStructure(flat);
}

const EMPTY_SNAPSHOT: DocumentSnapshot = { paragraphs: [], tables: [], images: [] };

function outlineChangeMap(
  changes: readonly OutlineChange[],
  side: "original" | "modified",
): Map<string, OutlineChange> {
  const result = new Map<string, OutlineChange>();
  for (const change of changes) {
    const anchor = side === "original" ? change.originalAnchor : change.modifiedAnchor;
    if (anchor?.target === "body-text") {
      result.set(anchorKey(anchor.sectionIndex, anchor.paragraphIndex), change);
    }
  }
  return result;
}

function paragraphKey(paragraph: ParagraphSnapshot): string {
  return anchorKey(paragraph.sectionIndex, paragraph.paragraphIndex);
}

function anchorKey(sectionIndex: number, paragraphIndex: number): string {
  return `${sectionIndex}:${paragraphIndex}`;
}

function statusFromAlignment(type: "equal" | "modified" | "added" | "removed"): StructureStatus {
  return type === "equal" ? "unchanged" : type;
}

export function flattenStructure(nodes: readonly StructureNode[]): StructureNode[] {
  return nodes.flatMap((node) => [node, ...flattenStructure(node.children)]);
}

export function structureNodeForChange(
  nodes: readonly StructureNode[],
  changeId: string,
): StructureNode | undefined {
  return flattenStructure(nodes)
    .filter((node) => node.changeIds.includes(changeId))
    .sort((left, right) => right.level - left.level)[0];
}

export function defaultExpandedStructureIds(nodes: readonly StructureNode[]): string[] {
  return nodes.filter((node) => node.children.length > 0).map((node) => node.id);
}

export function structureAncestorIds(
  nodes: readonly StructureNode[],
  selectedId: string,
): string[] {
  const path: string[] = [];
  const find = (candidates: readonly StructureNode[]): boolean => {
    for (const candidate of candidates) {
      path.push(candidate.id);
      if (candidate.id === selectedId) return true;
      if (find(candidate.children)) return true;
      path.pop();
    }
    return false;
  };
  return find(nodes) ? path.slice(0, -1) : [];
}

export function StructurePanel({
  nodes,
  selectedId,
  revealKey,
  scoped,
  onSelect,
  onClearScope,
}: {
  nodes: readonly StructureNode[];
  selectedId?: string;
  revealKey?: number;
  scoped: boolean;
  onSelect(node: StructureNode): void;
  onClearScope(): void;
}) {
  const treeKey = useMemo(
    () => flattenStructure(nodes).map((node) => node.id).join("\u0000"),
    [nodes],
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(defaultExpandedStructureIds(nodes)),
  );

  useEffect(() => {
    const validIds = new Set(flattenStructure(nodes).map((node) => node.id));
    const defaultIds = defaultExpandedStructureIds(nodes);
    setExpandedIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      for (const id of defaultIds) next.add(id);
      return setsEqual(current, next) ? current : next;
    });
  }, [treeKey]);

  useEffect(() => {
    if (!selectedId) return;
    const ancestorIds = structureAncestorIds(nodes, selectedId);
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const id of ancestorIds) next.add(id);
      return setsEqual(current, next) ? current : next;
    });
  }, [revealKey, selectedId, treeKey]);

  const toggle = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <section className="structure-panel" aria-label="문서 구조">
      <button
        type="button"
        className={`structure-all${!scoped ? " is-selected" : ""}`}
        onClick={onClearScope}
      >
        <span>전체 문서</span>
        <small>모든 변경</small>
      </button>
      <div className="structure-tree" role="tree" aria-label="병합된 문서 목차">
        {nodes.length === 0 ? (
          <p className="structure-empty">개요 레벨 목차가 없습니다.</p>
        ) : nodes.map((node) => (
          <StructureBranch
            key={node.id}
            node={node}
            selectedId={selectedId}
            expandedIds={expandedIds}
            onToggle={toggle}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function StructureBranch({
  node,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
}: {
  node: StructureNode;
  selectedId?: string;
  expandedIds: ReadonlySet<string>;
  onToggle(nodeId: string): void;
  onSelect(node: StructureNode): void;
}) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && expandedIds.has(node.id);
  return (
    <div
      role="treeitem"
      aria-level={node.level}
      aria-selected={node.id === selectedId}
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <div
        className="structure-row"
        style={{ paddingLeft: `${4 + Math.max(0, node.level - 1) * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="structure-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.id);
            }}
            aria-label={`${node.number} ${node.label} 하위 목차 ${expanded ? "접기" : "펼치기"}`.trim()}
            title={expanded ? "하위 목차 접기" : "하위 목차 펼치기"}
          >
            <span aria-hidden="true">{expanded ? "−" : "+"}</span>
          </button>
        ) : <span className="structure-toggle-spacer" aria-hidden="true" />}
        <button
          type="button"
          className={`structure-node structure-node--${node.status}${node.id === selectedId ? " is-selected" : ""}`}
          onClick={() => onSelect(node)}
          title={`${node.number} ${node.label}`.trim()}
        >
          <i aria-label={statusLabel(node.status)} />
          <span><b>{node.number}</b> {node.label}</span>
          {node.changeIds.length > 0 && <small>{node.changeIds.length}</small>}
        </button>
      </div>
      {hasChildren && expanded && (
        <div role="group">
          {node.children.map((child) => (
            <StructureBranch
              key={child.id}
              node={child}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function nestStructure(flat: readonly FlatStructureNode[]): StructureNode[] {
  const roots: StructureNode[] = [];
  const stack: StructureNode[] = [];
  for (const item of flat) {
    const node: StructureNode = { ...item, children: [] };
    while (stack.length > 0 && stack.at(-1)!.level >= node.level) stack.pop();
    if (stack.length > 0) stack.at(-1)!.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function changeInScope(
  change: Change,
  node: FlatStructureNode,
  nextBoundary: FlatStructureNode | undefined,
): boolean {
  const useModified = node.modifiedAnchor !== undefined;
  const anchor = useModified
    ? change.modifiedAnchor ?? change.modifiedContextAnchor
    : change.originalAnchor ?? change.originalContextAnchor;
  const start = useModified ? node.modifiedAnchor : node.originalAnchor;
  const end = useModified ? nextBoundary?.modifiedAnchor : nextBoundary?.originalAnchor;
  if (!anchor || !start) return false;
  const position = anchorOrder(anchor);
  return position >= anchorOrder(start) && (!end || position < anchorOrder(end));
}

function anchorOrder(anchor: DocumentAnchor): number {
  if (anchor.target === "image") return documentOrder(anchor.sectionIndex, anchor.paragraphIndex);
  return documentOrder(anchor.sectionIndex, anchor.paragraphIndex);
}

function documentOrder(sectionIndex: number, paragraphIndex: number): number {
  return sectionIndex * 10_000_000 + paragraphIndex;
}

function outlineAnchor(paragraph: ParagraphSnapshot): BodyTextAnchor {
  return {
    target: "body-text",
    sectionIndex: paragraph.sectionIndex,
    paragraphIndex: paragraph.paragraphIndex,
    textRange: { start: 0, end: Math.max(1, paragraph.text.length) },
    textFingerprint: paragraph.fingerprint,
    generatedPrefix: paragraph.outline ? {
      text: paragraph.outline.number,
      pageIndex: paragraph.outline.pageIndex,
    } : undefined,
    confidence: "exact",
  };
}

function statusFromChange(change: OutlineChange): StructureStatus {
  return change.kind === "added" ? "added" : change.kind === "removed" ? "removed" : "modified";
}

function statusLabel(status: StructureStatus): string {
  return {
    unchanged: "변경 없음",
    added: "추가",
    removed: "삭제",
    modified: "수정",
  }[status];
}

function hasOutline(
  paragraph: ParagraphSnapshot,
): paragraph is ParagraphSnapshot & { outline: NonNullable<ParagraphSnapshot["outline"]> } {
  return paragraph.outline !== undefined;
}
