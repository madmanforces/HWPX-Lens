import { useEffect, useRef } from "react";
import type { Change } from "@hwpx-lens/lens-core";
import type { ProductProfile } from "./profiles";

export type ChangeFilter =
  | "all"
  | "text"
  | "whitespace"
  | "outline"
  | "special-table"
  | "table"
  | "captioned-image"
  | "other-image";

interface ChangesPanelProps {
  changes: Change[];
  counts: Record<ChangeFilter, number>;
  filter: ChangeFilter;
  selectedIndex: number;
  comparing: boolean;
  analysisMessage?: string;
  ready: boolean;
  productProfile: ProductProfile;
  onSelect(index: number): void;
  onFilterChange(filter: ChangeFilter): void;
  onPrevious(): void;
  onNext(): void;
}

const KIND_LABEL: Record<Change["kind"], string> = {
  added: "추가",
  removed: "삭제",
  modified: "수정",
};

export function ChangesPanel({
  changes,
  counts,
  filter,
  selectedIndex,
  comparing,
  analysisMessage,
  ready,
  productProfile,
  onSelect,
  onFilterChange,
  onPrevious,
  onNext,
}: ChangesPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedIndex, changes.length]);
  return (
    <section className="changes-panel" aria-label="변경 목록">
      <div className="changes-panel__header">
        <div>
          <p className="section-kicker">CHANGES</p>
          <h2>변경 검토</h2>
        </div>
        <span className="change-count">{changes.length}</span>
      </div>

      <div className="filter-row" aria-label="변경 유형 필터">
        <FilterButton filter="all" active={filter} count={counts.all} onSelect={onFilterChange}>
          전체
        </FilterButton>
        <FilterButton filter="text" active={filter} count={counts.text} onSelect={onFilterChange}>
          본문
        </FilterButton>
        <FilterButton
          filter="whitespace"
          active={filter}
          count={counts.whitespace}
          onSelect={onFilterChange}
        >
          띄어쓰기
        </FilterButton>
        <FilterButton filter="outline" active={filter} count={counts.outline} onSelect={onFilterChange}>
          개요
        </FilterButton>
        {productProfile.specialTableCategory && (
          <FilterButton
            filter="special-table"
            active={filter}
            count={counts["special-table"]}
            onSelect={onFilterChange}
          >
            {productProfile.specialTableCategory.filterLabel}
          </FilterButton>
        )}
        <FilterButton filter="table" active={filter} count={counts.table} onSelect={onFilterChange}>
          표
        </FilterButton>
        <FilterButton
          filter="captioned-image"
          active={filter}
          count={counts["captioned-image"]}
          onSelect={onFilterChange}
        >
          캡션 이미지
        </FilterButton>
        <FilterButton
          filter="other-image"
          active={filter}
          count={counts["other-image"]}
          onSelect={onFilterChange}
        >
          기타 이미지
        </FilterButton>
        <button className="filter-chip" type="button" disabled title="M1 이후 지원">
          스타일
        </button>
      </div>

      <div className="change-nav">
        <button type="button" onClick={onPrevious} disabled={changes.length < 2} aria-label="이전 변경">
          ←
        </button>
        <span>{changes.length ? `${selectedIndex + 1} / ${changes.length}` : "0 / 0"}</span>
        <button type="button" onClick={onNext} disabled={changes.length < 2} aria-label="다음 변경">
          →
        </button>
      </div>

      <div ref={listRef} className="change-list" role="listbox" aria-label="문서 변경">
        {comparing ? (
          <PanelMessage
            title="의미 변경 분석 중"
            body={analysisMessage ?? "본문 문단과 표 셀을 비교하고 있습니다."}
            pulse
          />
        ) : !ready ? (
          <PanelMessage
            title={`${productProfile.pairNoun}를 선택하세요`}
            body="파일은 이 기기 안에서만 처리됩니다."
          />
        ) : changes.length === 0 ? (
          <PanelMessage title="선택한 유형의 변경 없음" body="다른 변경 유형 필터도 확인해 보세요." />
        ) : (
          changes.map((change, index) => (
            <button
              key={change.id}
              className={`change-card${index === selectedIndex ? " is-selected" : ""}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => onSelect(index)}
            >
              <span className={`change-kind change-kind--${change.kind}`}>
                {changeTypeLabel(change, productProfile)} · {KIND_LABEL[change.kind]}
              </span>
              {change.type !== "text" && (
                <span className="change-location">{change.locationLabel}</span>
              )}
              {change.originalText && (
                <span className="change-text change-text--before">{change.originalText}</span>
              )}
              {change.modifiedText && (
                <span className="change-text change-text--after">{change.modifiedText}</span>
              )}
            </button>
          ))
        )}
      </div>

      <div className="scope-note">
        <strong>Public Alpha 범위</strong>
        <span>{productProfile.scopeDescription}</span>
      </div>
    </section>
  );
}

export function changeCategory(
  change: Change,
  productProfile: ProductProfile,
): Exclude<ChangeFilter, "all"> {
  if (change.type === "outline") return "outline";
  if (change.type === "text") return change.detail === "whitespace" ? "whitespace" : "text";
  if (change.type === "image") {
    return change.classification === "captioned" ? "captioned-image" : "other-image";
  }
  return matchingSpecialTableRule(change, productProfile) ? "special-table" : "table";
}

export function countChanges(
  changes: readonly Change[],
  productProfile: ProductProfile,
): Record<ChangeFilter, number> {
  const counts: Record<ChangeFilter, number> = {
    all: changes.length,
    text: 0,
    whitespace: 0,
    outline: 0,
    "special-table": 0,
    table: 0,
    "captioned-image": 0,
    "other-image": 0,
  };
  for (const change of changes) counts[changeCategory(change, productProfile)] += 1;
  return counts;
}

export function changesInScope(
  changes: readonly Change[],
  changeIds: readonly string[] | undefined,
): Change[] {
  if (!changeIds) return [...changes];
  const scopedIds = new Set(changeIds);
  return changes.filter((change) => scopedIds.has(change.id));
}

function changeTypeLabel(change: Change, productProfile: ProductProfile): string {
  if (change.type === "outline") return "개요";
  if (change.type === "text") return change.detail === "whitespace" ? "띄어쓰기" : "본문";
  if (change.type === "image") {
    return change.classification === "captioned" ? "캡션 이미지" : "기타 이미지";
  }
  const specialRule = matchingSpecialTableRule(change, productProfile);
  if (specialRule) return specialRule.itemLabel;
  return "표";
}

function matchingSpecialTableRule(change: Change, productProfile: ProductProfile) {
  if (change.type !== "table" || !productProfile.specialTableCategory) return undefined;
  const labels = new Set(
    (change.classificationLabels ?? []).map(normalizeClassificationLabel),
  );
  return productProfile.specialTableCategory.rules.find((rule) =>
    rule.labels.some((label) => labels.has(normalizeClassificationLabel(label))),
  );
}

function normalizeClassificationLabel(label: string): string {
  return label.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
}

function FilterButton({
  filter,
  active,
  count,
  onSelect,
  children,
}: {
  filter: ChangeFilter;
  active: ChangeFilter;
  count: number;
  onSelect(filter: ChangeFilter): void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`filter-chip${active === filter ? " is-active" : ""}`}
      type="button"
      aria-pressed={active === filter}
      onClick={() => onSelect(filter)}
    >
      {children} <span aria-hidden="true">{count}</span>
    </button>
  );
}

function PanelMessage({
  title,
  body,
  pulse = false,
}: {
  title: string;
  body: string;
  pulse?: boolean;
}) {
  return (
    <div className="panel-message">
      <span className={`panel-message__mark${pulse ? " is-pulsing" : ""}`} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
