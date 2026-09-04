import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

const expectedVersion = "0.8.6";
const expectedHash = "58F3465C5EC679367AF93EC3E280418BB89BD4BF3EA3BD007251DF5E6FBE8EB9";
const root = process.cwd();
const packageJsonPath = path.resolve(root, "node_modules/@rhwp/core/package.json");
const packageWasmPath = path.resolve(root, "node_modules/@rhwp/core/rhwp_bg.wasm");
const patchedWasmPath = path.resolve(root, "vendor/rhwp-0.8.6-hwpx-lens/rhwp_bg.wasm");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
if (packageJson.version !== expectedVersion) {
  throw new Error(`rhwp runtime patch expects ${expectedVersion}, found ${packageJson.version}`);
}

const patchedBytes = await readFile(patchedWasmPath);
const patchedHash = sha256(patchedBytes);
if (patchedHash !== expectedHash) {
  throw new Error(`patched rhwp WASM checksum mismatch: ${patchedHash}`);
}

const currentBytes = await readFile(packageWasmPath);
if (sha256(currentBytes) !== expectedHash) {
  await copyFile(patchedWasmPath, packageWasmPath);
  console.log("Prepared @rhwp/core@0.8.6 with the caption AutoNumber WASM patch.");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}
