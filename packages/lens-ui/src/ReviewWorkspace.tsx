import type { Change } from "@hwpx-lens/lens-core";
import { ChangesPanel, type ChangeFilter } from "./ChangesPanel";
import { StructurePanel, type StructureNode } from "./StructurePanel";
import type { ProductProfile } from "./profiles";

export type ReviewWorkspaceTab = "structure" | "changes";

export type ReviewWorkspaceAction =
  | { type: "tab"; tab: ReviewWorkspaceTab }
  | { type: "structure"; nodeId: string }
  | { type: "clear-structure" }
  | { type: "change"; index: number }
  | { type: "filter"; filter: ChangeFilter }
  | { type: "previous" }
  | { type: "next" }
  | { type: "close" };

export interface DetachedReviewWorkspaceState {
  tab: ReviewWorkspaceTab;
  structure: StructureNode[];
  selectedStructureId?: string;
  structureRevealKey?: number;
  structureScoped: boolean;
  changes: Change[];
  counts: Record<ChangeFilter, number>;
  filter: ChangeFilter;
  selectedIndex: number;
  comparing: boolean;
  analysisMessage?: string;
  ready: boolean;
  productProfile: ProductProfile;
}

export interface ReviewWorkspaceProps {
  detached?: boolean;
  collapsed?: boolean;
  tab: ReviewWorkspaceTab;
  structure: readonly StructureNode[];
  selectedStructureId?: string;
  structureRevealKey?: number;
  structureScoped: boolean;
  changes: Change[];
  counts: Record<ChangeFilter, number>;
  filter: ChangeFilter;
  selectedIndex: number;
  comparing: boolean;
  analysisMessage?: string;
  ready: boolean;
  productProfile: ProductProfile;
  onTabChange(tab: ReviewWorkspaceTab): void;
  onStructureSelect(node: StructureNode): void;
  onStructureClear(): void;
  onChangeSelect(index: number): void;
  onFilterChange(filter: ChangeFilter): void;
  onPrevious(): void;
  onNext(): void;
  onDetachToggle(): void;
  onCollapseToggle?(): void;
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  if (props.collapsed && !props.detached) {
    return (
      <aside className="review-workspace is-collapsed" aria-label="접힌 검토 작업공간">
        <button
          type="button"
          className="review-workspace__expand"
          onClick={props.onCollapseToggle}
          aria-label="검토 작업공간 펼치기"
          title="검토 작업공간 펼치기"
        >
          <span aria-hidden="true">›</span>
          <b>검토</b>
          <small>{props.counts.all}</small>
        </button>
      </aside>
    );
  }
  return (
    <aside className={`review-workspace${props.detached ? " is-detached" : ""}`} aria-label="검토 작업공간">
      <header className="review-workspace__header">
        <div>
          <p className="section-kicker">REVIEW WORKSPACE</p>
          <strong>목차 구조와 변경사항</strong>
        </div>
        <div className="review-workspace__actions">
          {!props.detached && props.onCollapseToggle && (
            <button
              type="button"
              className="review-workspace__action collapse-workspace"
              onClick={props.onCollapseToggle}
              aria-expanded="true"
              aria-label="검토 작업공간 접기"
              title="검토 작업공간 접기"
            >
              접기
            </button>
          )}
          <button
            type="button"
            className="review-workspace__action detach-workspace"
            onClick={props.onDetachToggle}
            title={props.detached ? "검토 작업공간을 본창으로 복귀" : "검토 작업공간 분리"}
          >
            {props.detached ? "본창으로" : "분리"}
          </button>
        </div>
      </header>
      <nav className="review-tabs" aria-label="검토 보기">
        <button
          type="button"
          aria-pressed={props.tab === "structure"}
          onClick={() => props.onTabChange("structure")}
        >
          목차 구조
        </button>
        <button
          type="button"
          aria-pressed={props.tab === "changes"}
          onClick={() => props.onTabChange("changes")}
        >
          변경사항 <span>{props.counts.all}</span>
        </button>
      </nav>
      {props.tab === "structure" ? (
        <StructurePanel
          nodes={props.structure}
          selectedId={props.selectedStructureId}
          revealKey={props.structureRevealKey}
          scoped={props.structureScoped}
          onSelect={props.onStructureSelect}
          onClearScope={props.onStructureClear}
        />
      ) : (
        <ChangesPanel
          changes={props.changes}
          counts={props.counts}
          filter={props.filter}
          selectedIndex={props.selectedIndex}
          comparing={props.comparing}
          analysisMessage={props.analysisMessage}
          ready={props.ready}
          productProfile={props.productProfile}
          onSelect={props.onChangeSelect}
          onFilterChange={props.onFilterChange}
          onPrevious={props.onPrevious}
          onNext={props.onNext}
        />
      )}
    </aside>
  );
}
