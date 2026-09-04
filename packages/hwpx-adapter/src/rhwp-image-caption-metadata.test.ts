import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  extractImageCaptionMetadata,
  imageStableIndexKey,
} from "./rhwp-image-caption-metadata";

describe("extractImageCaptionMetadata", () => {
  it("indexes exact auto-numbered figure captions by rhwp stable path", () => {
    expect(typeof DOMParser).toBe("function");
    const fixture = zipSync({
      "Contents/section0.xml": Uint8Array.from(strToU8(`<?xml version="1.0" encoding="UTF-8"?>
        <hs:sec xmlns:hs="urn:section" xmlns:hp="urn:paragraph">
          <hp:p><hp:run>
            <hp:pic><hp:caption><hp:subList><hp:p><hp:run>
              <hp:t>그림 2-</hp:t><hp:ctrl><hp:autoNum num="3" numType="PICTURE"/></hp:ctrl>
              <hp:t>. 시험 그림</hp:t>
            </hp:run></hp:p></hp:subList></hp:caption></hp:pic><hp:t>본문</hp:t>
          </hp:run></hp:p>
        </hs:sec>`)),
    });
    const metadata = extractImageCaptionMetadata(fixture);
    expect([...metadata.entries()]).toEqual([["0:0:0", { label: "그림 2-3" }]]);
  });

  it("uses the same nested stable path as an image in a table cell", () => {
    const fixture = zipSync({
      "Contents/section1.xml": Uint8Array.from(strToU8(`<?xml version="1.0" encoding="UTF-8"?>
        <hs:sec xmlns:hs="urn:section" xmlns:hp="urn:paragraph">
          <hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run>
            <hp:pic><hp:caption><hp:subList><hp:p><hp:run>
              <hp:t>그림 4-</hp:t><hp:ctrl><hp:autoNum num="7" numType="PICTURE"/></hp:ctrl>
            </hp:run></hp:p></hp:subList></hp:caption></hp:pic>
          </hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>
        </hs:sec>`)),
    });

    const metadata = extractImageCaptionMetadata(fixture);
    expect(metadata.get(imageStableIndexKey([1, 0, 0, 0, 0, 0]))).toEqual({
      label: "그림 4-7",
    });
  });
});
