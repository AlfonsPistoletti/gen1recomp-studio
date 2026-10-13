// Updates for the desktop app (Tauri's updater plugin): the published GitHub
// release's latest.json says what the newest version is; its installer is
// downloaded, checked against the public key in tauri.conf.json, installed
// over this one, and the app restarts. The browser mode has nothing to update.

import { isTauri } from "../host/tauriHost.ts";
import { append, h, toast } from "./dom.ts";

// `quiet`: the check at start says nothing when there is no update or no
// connection; the menu entry reports either
export async function checkForUpdates(quiet: boolean): Promise<void> {
  if (!isTauri()) {
    if (!quiet) toast("Updates are for the desktop app.", "info");
    return;
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      if (!quiet) toast("You have the newest version.", "ok");
      return;
    }
    offer(update.version, update.body ?? "", async (progress) => {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          done += e.data.chunkLength;
          progress(total ? Math.round((done / total) * 100) : null);
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    });
  } catch (err) {
    if (!quiet) toast(`Couldn't check for updates: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

function offer(version: string, notes: string, install: (progress: (pct: number | null) => void) => Promise<void>): void {
  const dialog = h("dialog", {});
  const status = h("p", { class: "hint" });
  const later = h("button", { class: "btn", onclick: () => close() }, "Later");
  const now = h("button", { class: "btn primary" }, "Update now");
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  now.addEventListener("click", () => {
    now.disabled = later.disabled = true;
    status.textContent = "Downloading…";
    install((pct) => (status.textContent = pct === null ? "Downloading…" : `Downloading… ${pct}%`))
      .catch((err) => {
        status.textContent = `The update failed: ${err instanceof Error ? err.message : String(err)}`;
        later.disabled = false;
      });
  });
  dialog.addEventListener("cancel", (e) => {
    if (now.disabled) e.preventDefault();
  });
  append(dialog, [
    h("h3", {}, `Version ${version} is available`),
    notes ? h("pre", { class: "update-notes" }, notes) : null,
    h("p", { class: "hint" }, "Save your work first: the studio installs the update and restarts."),
    status,
    h("div", { class: "dialog-actions" }, later, now),
  ]);
  document.body.append(dialog);
  dialog.showModal();
}
