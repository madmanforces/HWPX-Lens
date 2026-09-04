import { afterEach, describe, expect, it, vi } from "vitest";
import {
  documentAnalysisKey,
  EphemeralLruCache,
  pairAnalysisKey,
  sha256Hex,
} from "./ephemeral-cache";

describe("EphemeralLruCache", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("evicts the least recently used entry and clears session data", () => {
    const cache = new EphemeralLruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.set("c", 3)).toBe("b");
    expect(cache.keys()).toEqual(["a", "c"]);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("creates versioned SHA-256 document and ordered pair keys", async () => {
    const fingerprint = await sha256Hex(new TextEncoder().encode("local document"));
    const original = documentAnalysisKey(fingerprint, "engine:snapshot-v1");
    const modified = documentAnalysisKey("0".repeat(64), "engine:snapshot-v1");
    expect(fingerprint).toHaveLength(64);
    expect(pairAnalysisKey(original, modified, "diff-v2")).not.toBe(
      pairAnalysisKey(modified, original, "diff-v2"),
    );
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("uses the same local SHA-256 result when WebCrypto is unavailable", async () => {
    const multiBlock = new TextEncoder().encode("offline document fingerprint".repeat(100));
    const expectedMultiBlock = await sha256Hex(multiBlock);
    vi.stubGlobal("crypto", undefined);
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex(multiBlock)).toBe(expectedMultiBlock);
  });
});
