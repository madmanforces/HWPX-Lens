import { execFileSync } from "node:child_process";

const mustBeIgnored = [
  "meetingForGpt/",
  "prCandidates/",
  "local-fixtures/",
  "private/",
];

for (const target of mustBeIgnored) {
  execFileSync("git", ["check-ignore", "-q", target], { stdio: "ignore" });
}

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const leaked = tracked.filter((file) =>
  mustBeIgnored.some((directory) => file.startsWith(directory)),
);

if (leaked.length) {
  console.error(`Local-only files are tracked:\n${leaked.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Ignored-path audit passed: local meeting, PR, and private fixture directories are untracked.");
}
