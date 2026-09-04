import { describe, expect, it } from "vitest";
import {
  compareDocumentSnapshots,
  createParagraphSnapshot,
  type Change,
  type DocumentSnapshot,
  type ParagraphSnapshot,
} from "@hwpx-lens/lens-core";
import {
  buildStructureTree,
  defaultExpandedStructureIds,
  flattenStructure,
  structureAncestorIds,
  structureNodeForChange,
  type StructureNode,
} from "./StructurePanel";

function paragraph(paragraphIndex: number, text: string, level: number): ParagraphSnapshot {
  return {
    sectionIndex: 0,
    paragraphIndex,
    text,
    normalizedText: text,
    fingerprint: `${paragraphIndex}:${text}`,
    outline: { level, number: `${paragraphIndex + 1}.`, pageIndex: paragraphIndex },
  };
}

function snapshot(...paragraphs: ParagraphSnapshot[]): DocumentSnapshot {
  return { paragraphs, tables: [], images: [] };
}

describe("merged Structure tree", () => {
  it("nests outline levels and scopes body changes under the deepest heading", () => {
    const original = snapshot(paragraph(0, "장", 1), paragraph(2, "절", 2));
    const modified = snapshot(paragraph(0, "장", 1), paragraph(2, "절", 2));
    const changes = [{
      id: "text-1",
      type: "text",
      kind: "modified",
      detail: "content",
      originalAnchor: {
        target: "body-text", sectionIndex: 0, paragraphIndex: 3, confidence: "exact",
      },
      modifiedAnchor: {
        target: "body-text", sectionIndex: 0, paragraphIndex: 3, confidence: "exact",
      },
    }] satisfies Change[];
    const tree = buildStructureTree(original, modified, changes);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].changeIds).toEqual(["text-1"]);
    expect(structureNodeForChange(tree, "text-1")?.label).toBe("절");
  });

  it("marks renamed and removed outline nodes without creating two trees", () => {
    const before = snapshot(paragraph(0, "운용", 1), paragraph(2, "삭제 절", 2));
    const after = snapshot(paragraph(0, "운용 지침", 1));
    const changes = [
      {
        id: "outline-1", type: "outline", kind: "modified", detail: "renamed",
        level: 1, locationLabel: "1. 운용 지침",
        originalAnchor: { target: "body-text", sectionIndex: 0, paragraphIndex: 0, confidence: "exact" },
        modifiedAnchor: { target: "body-text", sectionIndex: 0, paragraphIndex: 0, confidence: "exact" },
      },
      {
        id: "outline-2", type: "outline", kind: "removed", detail: "outline-removed",
        level: 2, locationLabel: "3. 삭제 절",
        originalAnchor: { target: "body-text", sectionIndex: 0, paragraphIndex: 2, confidence: "exact" },
      },
    ] satisfies Change[];
    const nodes = flattenStructure(buildStructureTree(before, after, changes));
    expect(nodes.map((node) => node.status)).toEqual(["modified", "removed"]);
  });

  it("expands only top-level branches by default and resolves the selected path", () => {
    const grandchild = structureNode("grandchild", 3);
    const child = structureNode("child", 2, [grandchild]);
    const root = structureNode("root", 1, [child]);
    expect(defaultExpandedStructureIds([root])).toEqual(["root"]);
    expect(structureAncestorIds([root], "grandchild")).toEqual(["root", "child"]);
    expect(structureAncestorIds([root], "missing")).toEqual([]);
  });

  it("shows a renamed heading once as modified", () => {
    const original = snapshot(paragraph(10, "설정 항목", 2));
    const modified = snapshot(paragraph(20, "설정항목", 2));
    const tree = buildStructureTree(
      original,
      modified,
      compareDocumentSnapshots(original, modified),
    );

    expect(flattenStructure(tree).map((node) => [node.label, node.status])).toEqual([
      ["설정항목", "modified"],
    ]);
  });

  it("does not let an original-only heading extend a current heading scope to the document end", () => {
    const original = snapshot(
      paragraph(0, "상위", 1),
      paragraph(10, "앞 절", 2),
      paragraph(20, "삭제 절", 2),
      paragraph(30, "뒤 절", 2),
      body(100, "이전 본문"),
    );
    const modified = snapshot(
      paragraph(0, "상위", 1),
      paragraph(10, "앞 절", 2),
      paragraph(30, "뒤 절", 2),
      body(100, "최신 본문"),
    );
    const changes = compareDocumentSnapshots(original, modified);
    const nodes = flattenStructure(buildStructureTree(original, modified, changes));
    const bodyChange = changes.find((change) => change.type === "text");

    expect(nodes.map((node) => node.label)).toEqual(["상위", "앞 절", "삭제 절", "뒤 절"]);
    expect(nodes.find((node) => node.label === "삭제 절")?.status).toBe("removed");
    expect(nodes.find((node) => node.label === "앞 절")?.changeIds).not.toContain(bodyChange?.id);
    expect(nodes.find((node) => node.label === "뒤 절")?.changeIds).toContain(bodyChange?.id);
  });
});

function body(paragraphIndex: number, text: string): ParagraphSnapshot {
  const value = createParagraphSnapshot(0, paragraphIndex, text);
  if (!value) throw new Error("Expected a body paragraph.");
  return value;
}

function structureNode(
  id: string,
  level: number,
  children: StructureNode[] = [],
): StructureNode {
  return {
    id,
    level,
    number: `${level}.`,
    label: id,
    status: "unchanged",
    changeIds: [],
    children,
  };
}
