import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const forbiddenPath = /(^|\/)(local-fixtures|private|meetingForGpt|prCandidates|\.codex-remote-attachments)(\/|$)|\.(hwpx|hwp|exe|msi)$/i;
const sensitiveContent = /C:\\Users\\|\/Users\/|github_pat_|ghp_|AKIA[0-9A-Z]{16}|BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY/i;
const restrictedFingerprints = new Map([
  [2, new Set(["58f0a3dc", "8d592b83", "6f57dc81", "f9c74c32", "f6ca6d79", "b6bd3094", "77264529", "36e759a0", "f1b4d56d", "a18fe628", "63e8dba9", "8d86bdaa", "61e243c6", "99ee47e6", "073f3c7d"])],
  [3, new Set(["6daa069e", "15a8cf4c", "b3698910", "84ce57ca"])],
  [4, new Set(["bf8eab99", "13e2f1c9", "d009ea2c", "f0020cb6", "122aa7bd", "51710900", "4da8a0a9", "a0fff1d1", "a2fba624", "031cf4f9"])],
  [5, new Set(["02317b8a", "0ffce1df"])],
  [6, new Set(["c746b6dd", "6f332041", "1ce36e21"])],
  [7, new Set(["a9df0958", "761a8c53", "9641ce23", "a4ef6883"])],
  [8, new Set(["03708996", "d24e5948", "ff139154"])],
  [9, new Set(["3d50c731"])],
  [11, new Set(["f1048d89", "855420ae"])],
  [12, new Set(["07d459e3", "f0ab85d0"])],
  [15, new Set(["735f059e", "b576e5f9"])],
]);
const requiredFiles = [
  "README.md",
  "LICENSE",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
];

const candidates = lines(git(["ls-files", "--cached", "--others", "--exclude-standard"]));
const currentForbidden = candidates.filter((path) => forbiddenPath.test(path));
const historyPaths = lines(git(["log", "--all", "--name-only", "--pretty=format:"]));
const historyForbidden = [...new Set(historyPaths.filter((path) => forbiddenPath.test(path)))];
const sensitiveSourceExemptions = new Set(["scripts/check-public-alpha.mjs"]);
const domainSourceExemptions = new Set(["scripts/check-public-alpha.mjs"]);
const sensitiveFiles = candidates.filter((path) => {
  if (sensitiveSourceExemptions.has(path)) return false;
  if (/\.(?:png|jpe?g|ico|icns|wasm|base64)$/i.test(path) || !existsSync(path)) return false;
  try {
    return sensitiveContent.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
});
const privateDomainFiles = candidates.filter((path) => {
  if (domainSourceExemptions.has(path)) return false;
  if (/\.(?:png|jpe?g|ico|icns|wasm|base64)$/i.test(path) || !existsSync(path)) return false;
  try {
    return containsRestrictedVocabulary(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
});
const missing = requiredFiles.filter((path) => !existsSync(path));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const failures = [
  currentForbidden.length ? `forbidden tracked paths: ${currentForbidden.join(", ")}` : "",
  historyForbidden.length ? `forbidden historical paths: ${historyForbidden.join(", ")}` : "",
  sensitiveFiles.length ? `sensitive-looking tracked content: ${sensitiveFiles.join(", ")}` : "",
  privateDomainFiles.length ? `private-domain terms in public content: ${privateDomainFiles.join(", ")}` : "",
  missing.length ? `missing public files: ${missing.join(", ")}` : "",
  packageJson.private !== true ? "root package must remain private" : "",
].filter(Boolean);

if (failures.length) {
  console.error(`Public Alpha repository audit failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Public Alpha repository audit passed: ${candidates.length} tracked/prospective paths, no private fixtures/binaries/domain terms/history leaks, package remains private.`,
);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function lines(value) {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function containsRestrictedVocabulary(value) {
  const normalized = value.normalize("NFC").toLocaleLowerCase();
  for (const [length, fingerprints] of restrictedFingerprints) {
    for (let index = 0; index <= normalized.length - length; index += 1) {
      if (fingerprints.has(fingerprint(normalized.slice(index, index + length)))) return true;
    }
  }
  return false;
}

function fingerprint(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
