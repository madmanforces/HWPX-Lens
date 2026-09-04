export interface ReviewInkTextFixture {
  name: string;
  original: string;
  modified: string;
}

export interface ReviewInkWhitespaceFixture extends ReviewInkTextFixture {
  missingSide: "original" | "modified";
  expectedMarkerCount: number;
}

export const REVIEW_INK_TEXT_FIXTURES: readonly ReviewInkTextFixture[] = [
  { name: "single-character-change", original: "장비를 켠다.", modified: "장비를 끈다." },
  { name: "word-change", original: "전원을 끈다.", modified: "전원을 차단한다." },
  {
    name: "sentence-change",
    original: "정상 상태를 확인한다.",
    modified: "정상 상태와 연결 상태를 확인한다.",
  },
  { name: "added-text", original: "", modified: "추가된 검토 문장" },
  { name: "removed-text", original: "삭제할 검토 문장", modified: "" },
  {
    name: "multiline-change",
    original: "첫 번째 문장입니다.\n두 번째 절차입니다.",
    modified: "첫 번째 문장입니다.\n두 번째 점검 절차입니다.",
  },
] as const;

export const REVIEW_INK_WHITESPACE_FIXTURES: readonly ReviewInkWhitespaceFixture[] = [
  {
    name: "missing-space-korean",
    original: "글자글자",
    modified: "글자 글자",
    missingSide: "original",
    expectedMarkerCount: 1,
  },
  {
    name: "removed-space-korean",
    original: "글자 글자",
    modified: "글자글자",
    missingSide: "modified",
    expectedMarkerCount: 1,
  },
  {
    name: "multiple-space-changes",
    original: "함운용및장비점검",
    modified: "함 운용 및 장비 점검",
    missingSide: "original",
    expectedMarkerCount: 4,
  },
  {
    name: "space-near-punctuation",
    original: "확인한다.다음 절차",
    modified: "확인한다. 다음 절차",
    missingSide: "original",
    expectedMarkerCount: 1,
  },
  {
    name: "line-wrap-space-change",
    original: "긴 문장이 화면의 다음 줄로 넘어가는경계에서도 위치를 유지한다.",
    modified: "긴 문장이 화면의 다음 줄로 넘어가는 경계에서도 위치를 유지한다.",
    missingSide: "original",
    expectedMarkerCount: 1,
  },
  {
    name: "missing-space-after-shared-prefix",
    original: "각 붙여쓰기",
    modified: "각 붙여 쓰기",
    missingSide: "original",
    expectedMarkerCount: 1,
  },
] as const;

export const PRECISION_SELECTION_FIXTURES = [
  { name: "single-character-selection", text: "ABCDE", selected: "C" },
  { name: "word-selection", text: "장비의 전원을 차단한다.", selected: "전원을" },
  {
    name: "multiline-selection",
    text: "첫 번째 문장입니다.\n두 번째 문장입니다.",
    selected: "문장입니다.\n두 번째",
  },
  { name: "table-cell-selection", text: "표 셀 내부 문장", selected: "셀 내부" },
] as const;
