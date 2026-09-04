const STYLE_ID = "hwpx-lens-local-font-aliases";

const LOCAL_FONT_ALIASES = [
  { family: "한양신명조", sources: ["HY신명조", "HYSinMyeongJo-Medium"] },
  { family: "한양견명조", sources: ["HY견명조", "HYMyeongJo-Extra"] },
  { family: "한양중고딕", sources: ["HY중고딕", "HYGothic-Medium"] },
  { family: "한양견고딕", sources: ["HY견고딕", "HYGothic-Extra"] },
] as const;

let readiness: Promise<void> | undefined;

/** Maps legacy HWP face names to the local names used by Hancom's installed fonts. */
export function ensureLocalFontAliasesReady(): Promise<void> {
  if (typeof document === "undefined" || !document.head) {
    return Promise.resolve();
  }

  if (!readiness) {
    readiness = (async () => {
      installStyleElement();
      if (!document.fonts) {
        return;
      }
      await Promise.allSettled(
        LOCAL_FONT_ALIASES.map(({ family }) => document.fonts.load(`16px "${family}"`)),
      );
    })();
  }

  return readiness;
}

function installStyleElement(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = LOCAL_FONT_ALIASES.map(
    ({ family, sources }) =>
      `@font-face{font-family:"${family}";src:${sources.map((source) => `local("${source}")`).join(",")};font-style:normal;font-weight:normal;font-display:block}`,
  ).join("\n");
  document.head.append(style);
}
