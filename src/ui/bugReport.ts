// "Report a bug…" (mod menu): shows what goes into the report (studio
// version, game, the session log) so the user sees it before sharing, copies
// it, and opens GitHub's bug form with version and game filled in. The log
// itself is pasted by the user: it is too long for a URL.

import { logText } from "../core/log.ts";
import { store } from "../core/store.ts";
import { isTauri } from "../host/tauriHost.ts";
import { errorText, h, toast } from "./dom.ts";

declare const __APP_VERSION__: string | undefined;
const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const ISSUES = "https://github.com/AlfonsPistoletti/gen1recomp-studio/issues/new";

export function bugReportDialog(): void {
  const game = store.project?.version ?? "none";
  const report = [
    `G1R Studio ${VERSION} (${isTauri() ? "desktop app" : "browser"}), game: ${game}`,
    navigator.userAgent,
    "",
    logText() || "(nothing logged this session)",
  ].join("\n");
  const area = h("textarea", { class: "mono", readonly: true, rows: 16, spellcheck: false });
  area.value = report;
  const dialog = h("dialog", { class: "modal bug-report" });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const url = `${ISSUES}?template=bug_report.yml&version=${encodeURIComponent(VERSION)}&game=${encodeURIComponent(game)}`;
  const send = h("button", {
    class: "btn primary",
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(report);
      } catch {
        area.select();
        document.execCommand("copy");
      }
      try {
        await store.project.host.openUrl(url);
        toast("Report copied: paste it into the Log field on GitHub", "ok");
        close();
      } catch (err) {
        toast(errorText(err), "error");
      }
    },
  }, "Copy and open GitHub");
  dialog.append(
    h("h3", {}, "Report a bug"),
    h("p", { class: "hint" }, "This goes into the report: the studio version, the game, and what happened this session (your user folder's name is left out). Nothing is sent by itself: the button copies it and opens the bug form on GitHub, where you paste it and describe what went wrong."),
    area,
    h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: close }, "Cancel"), send),
  );
  document.body.append(dialog);
  dialog.showModal();
}
