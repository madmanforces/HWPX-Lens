import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveDialog, writeTextFile } = vi.hoisted(() => ({
  saveDialog: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: saveDialog }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile }));

describe("desktop Change Set save", () => {
  beforeEach(() => {
    saveDialog.mockReset();
    writeTextFile.mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("keeps state untouched when the native save dialog is cancelled", async () => {
    saveDialog.mockResolvedValue(null);
    const { saveChangeSetFile } = await import("../apps/desktop/src/save-change-set");
    await expect(saveChangeSetFile({
      contents: "{}\n",
      defaultFileName: "comparison.json",
    })).resolves.toBe("cancelled");
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("writes exact UTF-8 text only after a path is selected", async () => {
    saveDialog.mockResolvedValue("D:\\exports\\comparison.json");
    writeTextFile.mockResolvedValue(undefined);
    const { saveChangeSetFile } = await import("../apps/desktop/src/save-change-set");
    await expect(saveChangeSetFile({
      contents: "{\n  \"schemaVersion\": \"1.0.0\"\n}\n",
      defaultFileName: "comparison.json",
    })).resolves.toBe("saved");
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: "comparison.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    expect(writeTextFile).toHaveBeenCalledWith(
      "D:\\exports\\comparison.json",
      "{\n  \"schemaVersion\": \"1.0.0\"\n}\n",
    );
  });

  it("propagates write failures instead of reporting success", async () => {
    saveDialog.mockResolvedValue("D:\\exports\\comparison.json");
    writeTextFile.mockRejectedValue(new Error("write failed"));
    const { saveChangeSetFile } = await import("../apps/desktop/src/save-change-set");
    await expect(saveChangeSetFile({
      contents: "{}\n",
      defaultFileName: "comparison.json",
    })).rejects.toThrow("write failed");
  });
});
