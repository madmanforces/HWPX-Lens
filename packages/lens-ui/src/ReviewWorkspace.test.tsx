import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { GENERAL_DOCUMENT_PROFILE, type ProductProfile } from "./profiles";

const SPECIALIZED_PROFILE: ProductProfile = {
  ...GENERAL_DOCUMENT_PROFILE,
  id: "specialized-test",
  displayName: "Specialized test",
  specialTableCategory: {
    filterLabel: "Priority group",
    summaryLabel: "Priority",
    rules: [{ labels: ["Priority"], itemLabel: "Priority table" }],
  },
};

describe("ReviewWorkspace", () => {
  it("uses the same configured action-button UI for collapse and detach", () => {
    const markup = renderToStaticMarkup(<ReviewWorkspace
      tab="structure"
      structure={[]}
      structureScoped={false}
      changes={[]}
      counts={{
        all: 0, text: 0, whitespace: 0, outline: 0, "special-table": 0, table: 0,
        "captioned-image": 0, "other-image": 0,
      }}
      filter="all"
      selectedIndex={0}
      comparing={false}
      ready={false}
      productProfile={GENERAL_DOCUMENT_PROFILE}
      onTabChange={vi.fn()}
      onStructureSelect={vi.fn()}
      onStructureClear={vi.fn()}
      onChangeSelect={vi.fn()}
      onFilterChange={vi.fn()}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onDetachToggle={vi.fn()}
      onCollapseToggle={vi.fn()}
    />);

    expect(markup).toContain('class="review-workspace__action collapse-workspace"');
    expect(markup).toContain('aria-label="검토 작업공간 접기"');
    expect(markup).toContain('class="review-workspace__action detach-workspace"');
  });

  it("collapses to a narrow, count-preserving document control", () => {
    const markup = renderToStaticMarkup(<ReviewWorkspace
      collapsed
      tab="changes"
      structure={[]}
      structureScoped={false}
      changes={[]}
      counts={{
        all: 0, text: 0, whitespace: 0, outline: 0, "special-table": 0, table: 0,
        "captioned-image": 0, "other-image": 0,
      }}
      filter="all"
      selectedIndex={0}
      comparing={false}
      ready={false}
      productProfile={GENERAL_DOCUMENT_PROFILE}
      onTabChange={vi.fn()}
      onStructureSelect={vi.fn()}
      onStructureClear={vi.fn()}
      onChangeSelect={vi.fn()}
      onFilterChange={vi.fn()}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onDetachToggle={vi.fn()}
      onCollapseToggle={vi.fn()}
    />);
    expect(markup).toContain("is-collapsed");
    expect(markup).toContain("검토 작업공간 펼치기");
  });

  it("keeps the scoped total in the tab even when a type filter has no results", () => {
    const markup = renderToStaticMarkup(<ReviewWorkspace
      tab="changes"
      structure={[]}
      structureScoped
      changes={[]}
      counts={{
        all: 4, text: 4, whitespace: 0, outline: 0, "special-table": 0, table: 0,
        "captioned-image": 0, "other-image": 0,
      }}
      filter="captioned-image"
      selectedIndex={0}
      comparing={false}
      ready
      productProfile={GENERAL_DOCUMENT_PROFILE}
      onTabChange={vi.fn()}
      onStructureSelect={vi.fn()}
      onStructureClear={vi.fn()}
      onChangeSelect={vi.fn()}
      onFilterChange={vi.fn()}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onDetachToggle={vi.fn()}
    />);
    expect(markup).toContain("변경사항 <span>4</span>");
    expect(markup).toContain('캡션 이미지 <span aria-hidden="true">0</span>');
    expect(markup).toContain("선택한 유형의 변경 없음");
  });

  it("shows an additional table filter only when a local profile configures it", () => {
    const common = {
      tab: "changes" as const,
      structure: [],
      structureScoped: false,
      changes: [],
      counts: {
        all: 0, text: 0, whitespace: 0, outline: 0, "special-table": 0, table: 0,
        "captioned-image": 0, "other-image": 0,
      },
      filter: "all" as const,
      selectedIndex: 0,
      comparing: false,
      ready: true,
      onTabChange: vi.fn(),
      onStructureSelect: vi.fn(),
      onStructureClear: vi.fn(),
      onChangeSelect: vi.fn(),
      onFilterChange: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onDetachToggle: vi.fn(),
    };
    const general = renderToStaticMarkup(
      <ReviewWorkspace {...common} productProfile={GENERAL_DOCUMENT_PROFILE} />,
    );
    const specialized = renderToStaticMarkup(
      <ReviewWorkspace {...common} productProfile={SPECIALIZED_PROFILE} />,
    );

    expect(general).not.toContain("Priority group");
    expect(specialized).toContain("Priority group");
  });
});
