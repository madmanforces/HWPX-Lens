import { readFile } from "node:fs/promises";
import path from "node:path";

type FixtureVariant = "public" | "modified" | "repacked";

export async function loadBodyTextFixture(
  variant: FixtureVariant = "public",
): Promise<Uint8Array> {
  const fixturePath = path.resolve(`tests/fixtures/body-text-${variant}.hwpx.base64`);
  const encoded = (await readFile(fixturePath, "utf8")).trim();
  return new Uint8Array(Buffer.from(encoded, "base64"));
}
