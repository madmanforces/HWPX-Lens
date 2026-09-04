import { describe, expect, it } from "vitest";
import { semanticPlainTextForRange } from "./SemanticTextLayer";

describe("semantic clipboard text", () => {
  it("joins visual runs in one paragraph and separates logical paragraphs", () => {
    const surface = document.createElement("div");
    surface.innerHTML = [
      '<span class="semantic-text-run" data-block-id="body-0-0">장비의 </span>',
      '<span class="semantic-text-run" data-block-id="body-0-0">전원을 차단한다.</span>',
      '<span class="semantic-text-run" data-block-id="body-0-1">연결 상태를 확인한다.</span>',
    ].join("");
    document.body.append(surface);
    const runs = surface.querySelectorAll("span");
    const range = document.createRange();
    range.setStart(runs[0].firstChild!, 0);
    range.setEnd(runs[2].firstChild!, runs[2].textContent!.length);

    expect(semanticPlainTextForRange(surface, range)).toBe(
      "장비의 전원을 차단한다.\r\n연결 상태를 확인한다.",
    );
    surface.remove();
  });

  it("preserves partial character offsets", () => {
    const surface = document.createElement("div");
    surface.innerHTML = '<span class="semantic-text-run" data-block-id="body-0-0">장비의 전원을 차단한다.</span>';
    document.body.append(surface);
    const text = surface.querySelector("span")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 7);

    expect(semanticPlainTextForRange(surface, range)).toBe("전원을");
    surface.remove();
  });
});
