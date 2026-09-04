import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve("test-results", "public-fixtures");
await mkdir(outputDirectory, { recursive: true });

for (const name of ["body-text-public", "body-text-modified"]) {
  const encoded = await readFile(path.resolve("tests", "fixtures", `${name}.hwpx.base64`), "utf8");
  await writeFile(path.join(outputDirectory, `${name}.hwpx`), Buffer.from(encoded.trim(), "base64"));
}

console.log(outputDirectory);
