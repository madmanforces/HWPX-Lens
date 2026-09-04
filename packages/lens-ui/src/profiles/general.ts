import type { ProductProfile } from "./types";

/** Public/GitHub profile. All table-shaped content uses the standard table category. */
export const GENERAL_DOCUMENT_PROFILE: ProductProfile = Object.freeze({
  id: "general",
  displayName: "일반 문서",
  documentNoun: "문서",
  pairNoun: "두 문서",
  scopeDescription: "본문·띄어쓰기·개요·표·캡션 이미지·기타 이미지 활성화 / 스타일 비활성",
});
