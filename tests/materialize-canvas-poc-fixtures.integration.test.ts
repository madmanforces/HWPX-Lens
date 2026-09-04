import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "vitest";
import {
  createFidelityFixture,
  FIDELITY_FIXTURE_NAMES,
} from "./helpers/rhwp-fidelity-fixtures";

const enabled = process.env.MATERIALIZE_CANVAS_POC_FIXTURES === "1";

describe.skipIf(!enabled)("materialize ignored Canvas PoC fixtures", () => {
  it("writes the synthetic fidelity corpus under test-results only", async () => {
    const output = path.resolve("test-results", "canvas-poc-fixtures");
    await mkdir(output, { recursive: true });
    for (const name of FIDELITY_FIXTURE_NAMES) {
      await writeFile(path.join(output, `${name}.hwpx`), await createFidelityFixture(name));
    }
  });
});
