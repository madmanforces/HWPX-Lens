# Change Set JSON 형식

HWPX Lens의 Change Set JSON은 두 HWPX 문서에서 확인한 비교 사실과 의미 위치를 다른 로컬 프로그램이 다시 검증할 수 있도록 기록한 범용 교환 형식입니다. 문서 수정 명령이 아니며, 원본 파일을 포함하거나 업로드하지 않습니다.

현재 형식 버전은 `1.0.0`입니다. HWPX Lens 제품 버전과 JSON 형식 버전은 서로 독립적으로 관리됩니다.

## 내보내기

1. `ORIGINAL`에 이전 문서, `MODIFIED`에 최신 문서를 엽니다.
2. 분석이 완료되면 상단의 `Change Set JSON 내보내기`를 누릅니다.
3. 민감정보 경고를 확인하고 저장할 `.json` 위치를 선택합니다.

저장 대화상자를 취소하면 파일을 만들지 않으며 현재 비교 상태도 바뀌지 않습니다. 저장 파일은 UTF-8(BOM 없음), LF 줄바꿈, 2칸 들여쓰기와 마지막 LF 한 개를 사용합니다.

> Change Set에는 파일명, 변경 전후 텍스트, 전체 목차 경로, 위치와 지문이 포함될 수 있습니다. 원본 이미지 바이너리는 포함되지 않지만 문서 내용은 민감정보나 개인정보일 수 있으므로 저장·공유 위치를 확인해야 합니다.

## 문서 방향

- `documents.original.role`은 항상 `previous`입니다.
- `documents.modified.role`은 항상 `latest`입니다.
- `added`는 최신 문서에만 있는 대상입니다.
- `removed`는 이전 문서에만 있는 대상입니다.
- `modified`는 두 문서에 대응 대상이 모두 있는 변경입니다.

이 역할은 파일을 선택한 순서를 그대로 반영하며 자동으로 뒤집지 않습니다.

## 최상위 구조

직렬화 순서는 다음과 같이 고정됩니다.

```json
{
  "schemaVersion": "1.0.0",
  "comparisonId": "cmp-...",
  "exportId": "exp-...",
  "exportedAt": "2026-09-04T14:30:00+09:00",
  "generator": {},
  "analysis": {},
  "coordinateSystem": {},
  "fingerprintSpec": {},
  "documents": {},
  "summary": {},
  "changes": [],
  "outlineMappings": []
}
```

`changes`는 화면의 Review Ink와 같은 canonical Change Model을 소비합니다. Export만을 위해 변경을 다시 계산하지 않습니다. `outlineMappings`는 변경된 목차뿐 아니라 양쪽 문서의 변경 없는 목차까지 정확히 한 번씩 포함합니다.

## 두 종류의 ID

`exportId`는 한 번의 저장 행위를 식별하므로 반복 저장할 때 바뀝니다. `comparisonId`는 동일한 두 원시 파일과 동일한 `schemaVersion`을 식별하므로 반복 저장과 컴퓨터가 달라도 같습니다.

`comparisonId` 계산 전 입력을 다음과 같이 정규화합니다.

- 두 SHA-256: 앞뒤 ASCII 공백 제거, lowercase, 정확히 64자리 hex 검증
- schemaVersion: 선행 `v`가 없는 strict SemVer 검증 및 canonical 표기

preimage는 UTF-8, BOM 없음, LF만 사용하고 마지막 줄바꿈은 넣지 않습니다.

```text
hwpx-lens-comparison-id-v1
originalSha256:<original raw-file SHA-256>
modifiedSha256:<modified raw-file SHA-256>
schemaVersion:<canonical schema version>
```

결과는 `cmp-`와 preimage SHA-256 lowercase hex 64자리의 조합입니다. 파일명, 경로, 생성 시각, 제품 버전이나 JSON object 순서는 입력에 포함되지 않습니다.

## 문서와 지문

`documents`의 `sha256`과 `byteLength`는 압축 해제한 XML이 아니라 사용자가 선택한 HWPX 전체 원시 바이트 기준입니다. `fileName`에는 basename만 기록하며 로컬 절대경로는 기록하지 않습니다.

본문과 표 셀 텍스트 지문은 다음 규칙을 사용합니다.

1. Unicode NFC
2. 제어문자와 zero-width 문자 제거
3. 탭·개행·일반 공백의 연속을 공백 하나로 축약
4. 앞뒤 공백 제거
5. JavaScript UTF-16 code unit 기준 FNV-1a 32비트
6. lowercase hex 8자리

32비트 지문은 빠른 위치 확인용입니다. 충돌 가능성이 있으므로 소비자는 `normalizedText`, 실제 `text`, Anchor와 원시 파일 SHA-256도 함께 확인해야 합니다.

이미지 `sourceHash`는 원래 encoded resource bytes의 SHA-256입니다. 원본 이미지 bytes, Base64, `Uint8Array`, Blob, data URL, 전체 SVG나 페이지 bitmap은 Change Set에 넣지 않습니다.

## 좌표와 Anchor

모든 section, paragraph, table, control, cell, row, column, page index는 0부터 시작합니다. `rowSpan`과 `columnSpan`은 크기이므로 1 이상입니다. 텍스트 offset은 JavaScript UTF-16 code unit이며 range는 start inclusive, end exclusive입니다.

Anchor 종류는 다음 네 가지입니다.

- `body-text`: section, paragraph, text range와 텍스트 지문
- `table`: section, paragraph, control과 table index
- `table-cell`: table 위치와 cell/row/column/span 및 셀 텍스트 지문
- `image`: section, paragraph, image index, stable key와 문서 좌표 rect

각 존재하는 변경 side에는 해당 Anchor와 root부터 현재 항목까지의 전체 `outlinePath`가 있습니다. 목차 밖 영역은 `pathText: ""`, `segments: []`로 나타낼 수 있습니다.

## 변경 유형

공통 `kind`는 `added`, `removed`, `modified`입니다. 유형과 detail은 다음과 같습니다.

| type | detail |
| --- | --- |
| `text` | `content`, `whitespace` |
| `outline` | `renamed`, `outline-added`, `outline-removed`, `outline-moved` |
| `table` | `cell-text`, `structure`, `table-added`, `table-removed` |
| `image` | `image-added`, `image-removed`, `image-changed` |

텍스트 data에는 기존 character-level segment와 양쪽 range를 보존합니다. 표 data에는 적용 가능한 table/cell 구조와 지문을 넣습니다. 이미지 data에는 binary/rendering 변경 여부와 source/render metadata만 넣습니다.

`mappingConfidence`는 `exact`, `contextual`, `approximate` 중 하나입니다. 중복 제목이나 유사도 기반 대응을 근거 없이 `exact`로 승격하지 않습니다.

## 전체 목차 대응표

각 mapping의 `relations`는 다음 값을 사용합니다.

- `unchanged`: 제목, 부모 경로와 범위 내용이 같음
- `moved`: 같은 항목의 부모 경로가 달라짐
- `renamed`: 대응 항목의 제목이 달라짐
- `modified`: 해당 목차 범위 안에 본문·표·이미지 변경이 있음
- `added`: 최신 문서에만 있음
- `removed`: 이전 문서에만 있음

`moved`와 `modified`처럼 여러 관계를 함께 기록할 수 있습니다. `added`, `removed`, `unchanged`는 다른 관계와 섞지 않습니다. `relatedChangeIds`는 해당 범위의 실제 `changes[].id`만 참조합니다.

## 검증

고정 JSON Schema는 [change-set.schema.json](../schemas/change-set.schema.json)에 있으며 Draft 2020-12를 사용합니다. Schema는 필수 필드, 타입, enum, 역할, side nullability와 숫자 범위를 확인합니다.

Lens의 의미 무결성 validator는 Schema만으로 확인하기 어려운 다음 항목도 검사합니다.

- raw bytes SHA-256과 byteLength
- canonical `comparisonId`
- analysis status와 완료 유형
- ID 고유성, 참조와 summary 집계
- 변경 side 규칙과 Anchor 범위
- text normalization과 지문
- 전체 목차 coverage, 경로와 relation
- 이미지 source metadata
- 비 JSON 숫자, 함수, binary, data URL, 절대경로와 credential 패턴

같은 1.x 버전의 소비자는 모르는 선택 필드를 무시할 수 있습니다. 필수 필드 삭제, 기존 의미 변경이나 구조 변경은 major version 변경 대상입니다.

## 결정성 검사

동일 입력을 두 번 독립 export하고 JSON을 다시 읽은 뒤 JSON Pointer `/exportId`와 `/exportedAt`만 고정 sentinel로 바꿉니다. 그 결과를 다시 deterministic serializer로 직렬화했을 때 byte-for-byte 같아야 합니다. `/comparisonId`를 비롯한 다른 ID나 시각 필드는 제외하거나 마스킹하지 않습니다.

## 오프라인과 보안

생성, hash, 검증과 저장은 모두 로컬에서 수행됩니다. Change Set 내보내기는 telemetry, 문서 upload, 외부 API 또는 CDN 요청을 추가하지 않습니다. 소비 프로그램은 JSON의 지문만 믿지 말고 사용자가 선택한 실제 HWPX raw SHA-256과 semantic content를 다시 확인해야 합니다.
