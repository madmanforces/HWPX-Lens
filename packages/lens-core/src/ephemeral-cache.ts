const SHA_256_HEX_LENGTH = 64;

/**
 * Session-only LRU cache. It never writes document text, snapshots, or hashes
 * to storage. Consumers must clear it when their application/session closes.
 */
export class EphemeralLruCache<Value> {
  private readonly values = new Map<string, Value>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("캐시 용량은 1 이상의 정수여야 합니다.");
    }
  }

  get size(): number {
    return this.values.size;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  peek(key: string): Value | undefined {
    return this.values.get(key);
  }

  get(key: string): Value | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: Value): string | undefined {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size <= this.capacity) return undefined;
    const oldest = this.values.keys().next().value as string | undefined;
    if (oldest !== undefined) this.values.delete(oldest);
    return oldest;
  }

  keys(): string[] {
    return [...this.values.keys()];
  }

  clear(): void {
    this.values.clear();
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle
    ? new Uint8Array(await subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))
    : sha256Fallback(bytes);
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Local fallback for WebViews or LAN test origins where WebCrypto is unavailable. */
function sha256Fallback(bytes: Uint8Array): Uint8Array {
  const constants = Uint32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bitLength = bytes.length * 8;
  const hash = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const completeLength = Math.floor(bytes.length / 64) * 64;
  const sourceView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < completeLength; offset += 64) {
    sha256Block(sourceView, offset, words, hash, constants);
  }

  const remaining = bytes.length - completeLength;
  const tail = new Uint8Array(remaining < 56 ? 64 : 128);
  tail.set(bytes.subarray(completeLength));
  tail[remaining] = 0x80;
  const tailView = new DataView(tail.buffer);
  tailView.setUint32(tail.length - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  tailView.setUint32(tail.length - 4, bitLength >>> 0, false);
  for (let offset = 0; offset < tail.length; offset += 64) {
    sha256Block(tailView, offset, words, hash, constants);
  }

  const result = new Uint8Array(32);
  const resultView = new DataView(result.buffer);
  hash.forEach((word, index) => resultView.setUint32(index * 4, word, false));
  return result;
}

function sha256Block(
  view: DataView,
  offset: number,
  words: Uint32Array,
  hash: Uint32Array,
  constants: Uint32Array,
): void {
  for (let index = 0; index < 16; index += 1) {
    words[index] = view.getUint32(offset + index * 4, false);
  }
  for (let index = 16; index < 64; index += 1) {
    const before15 = words[index - 15];
    const before2 = words[index - 2];
    const sigma0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
    const sigma1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
    words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
  }

  let [a, b, c, d, e, f, g, h] = hash;
  for (let index = 0; index < 64; index += 1) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choose = (e & f) ^ (~e & g);
    const temporary1 = (h + sum1 + choose + constants[index] + words[index]) >>> 0;
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temporary2 = (sum0 + majority) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + temporary1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temporary1 + temporary2) >>> 0;
  }
  hash[0] = (hash[0] + a) >>> 0;
  hash[1] = (hash[1] + b) >>> 0;
  hash[2] = (hash[2] + c) >>> 0;
  hash[3] = (hash[3] + d) >>> 0;
  hash[4] = (hash[4] + e) >>> 0;
  hash[5] = (hash[5] + f) >>> 0;
  hash[6] = (hash[6] + g) >>> 0;
  hash[7] = (hash[7] + h) >>> 0;
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

export function documentAnalysisKey(fingerprint: string, analysisIdentity: string): string {
  if (!new RegExp(`^[0-9a-f]{${SHA_256_HEX_LENGTH}}$`, "u").test(fingerprint)) {
    throw new Error("문서 fingerprint가 SHA-256 형식이 아닙니다.");
  }
  if (!analysisIdentity) throw new Error("분석 schema identity가 비어 있습니다.");
  return `${analysisIdentity}:${fingerprint}`;
}

export function pairAnalysisKey(
  originalDocumentKey: string,
  modifiedDocumentKey: string,
  diffIdentity: string,
): string {
  if (!originalDocumentKey || !modifiedDocumentKey || !diffIdentity) {
    throw new Error("문서 pair cache key를 만들 수 없습니다.");
  }
  return `${diffIdentity}:${originalDocumentKey}>${modifiedDocumentKey}`;
}
