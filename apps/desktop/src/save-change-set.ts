import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { SaveChangeSetFile } from "@hwpx-lens/lens-ui";

export const saveChangeSetFile: SaveChangeSetFile = async ({
  contents,
  defaultFileName,
}) => {
  if ("__TAURI_INTERNALS__" in window) {
    const selectedPath = await save({
      defaultPath: defaultFileName,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!selectedPath) return "cancelled";
    await writeTextFile(selectedPath, contents);
    return "saved";
  }

  // Browser development fallback. Production desktop builds use the native
  // save dialog above and never send the payload to a remote service.
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultFileName;
  link.click();
  URL.revokeObjectURL(url);
  return "saved";
};
