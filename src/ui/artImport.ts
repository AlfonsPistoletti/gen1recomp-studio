// Import dialog for sprite art: pick or drop an image, see it fitted to the
// target size and either converted to the 4 Game Boy shades (default; the
// game colors those with its palettes) or kept in full color (trueColor).
// Resolves with PNG bytes, or null when cancelled.

import { h, toast } from "./dom.ts";

export interface ArtTarget {
  label: string; // "Front sprite"
  width: number;
  height: number;
  // sheets of several equal frames stacked vertically (menu icons: 2)
  frames?: number;
  // where a smaller image sits in the box
  align: "bottom" | "center";
  // square sizes to choose from (front sprites: 40, 48, 56); width/height
  // is the preselected one
  sizes?: number[];
  // battle sprites keep their transparent pixels: the engine grounds a pic
  // by its transparent rows and leaves them alone when it recolours
  keepTransparent?: boolean;
}

export interface ArtResult {
  data: Uint8Array;
  trueColor: boolean;
  // the chosen size, for targets with `sizes`
  size: number;
}

// the four shades the engine's sprite code expects (sheet grays)
const SHADES = [0, 85, 170, 255];

export function loadFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${file.name} is not an image the browser can read`));
    img.src = url;
  });
}

// The image fitted into one frame: whole-number upscaling keeps pixel art
// crisp, anything bigger is scaled down smoothly.
function fitFrame(img: HTMLImageElement, w: number, h: number, align: ArtTarget["align"]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const fit = Math.min(w / img.width, h / img.height);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.imageSmoothingQuality = "high";
  const dw = Math.max(1, Math.round(img.width * scale));
  const dh = Math.max(1, Math.round(img.height * scale));
  const x = Math.floor((w - dw) / 2);
  const y = align === "bottom" ? h - dh : Math.floor((h - dh) / 2);
  ctx.drawImage(img, x, y, dw, dh);
  return c;
}

function render(img: HTMLImageElement, t: ArtTarget, shades: boolean, brightness: number): HTMLCanvasElement {
  const frames = t.frames ?? 1;
  const out = document.createElement("canvas");
  out.width = t.width;
  out.height = t.height * frames;
  const ctx = out.getContext("2d")!;
  // an image that already is the whole sheet is used as is, else one frame
  // is fitted and repeated
  if (frames > 1 && img.width === t.width && img.height === t.height * frames) {
    ctx.drawImage(img, 0, 0);
  } else if (frames > 1 && img.width === t.width * frames && img.height === t.height) {
    // the frames side by side: stacked the way the sheet holds them
    for (let f = 0; f < frames; f++) ctx.drawImage(img, f * t.width, 0, t.width, t.height, 0, f * t.height, t.width, t.height);
  } else {
    const frame = fitFrame(img, t.width, t.height, t.align);
    for (let f = 0; f < frames; f++) ctx.drawImage(frame, 0, f * t.height);
  }
  if (!shades) return out;
  const data = ctx.getImageData(0, 0, out.width, out.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (t.keepTransparent && px[i + 3] === 0) continue;
    // transparent = white, like the background the game draws sprites on
    const a = px[i + 3] / 255;
    const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * a + 255 * (1 - a);
    const v = Math.max(0, Math.min(255, lum + brightness));
    const shade = SHADES[Math.min(3, Math.floor(v / 64))];
    px[i] = px[i + 1] = px[i + 2] = shade;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return out;
}

// Synchronous on purpose: toBlob's callback was seen to never arrive after a
// click in the dialog, which left the import hanging.
export function pngBytes(canvas: HTMLCanvasElement): Uint8Array {
  const b64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function importArt(initial: ArtTarget, opts: { trueColor: boolean }): Promise<ArtResult | null> {
  return new Promise((resolve) => {
    let target = initial;
    let img: HTMLImageElement | null = null;
    let trueColor = opts.trueColor;
    let brightness = 0;
    const dialog = h("dialog", { class: "art-dialog" });
    const file = h("input", { type: "file", accept: "image/png,image/gif,image/jpeg,image/webp,image/bmp", hidden: true });
    const drop = h("div", { class: "art-drop" }, "Drop an image here or ", h("button", { class: "btn small", onclick: () => file.click() }, "choose a file"));
    const preview = h("div", { class: "art-preview" });
    const info = h("p", { class: "hint" });
    const describe = () =>
      (info.textContent = `${target.label}: ${target.width}×${target.height * (target.frames ?? 1)} px${target.frames ? `, ${target.frames} frames of ${target.width}×${target.height}` : ""}.`);
    describe();
    // front sprites come in a few sizes; the choice sets the Pokémon's frontSize
    const sizeSel = initial.sizes
      ? h("select", {}, ...initial.sizes.map((n) => h("option", { value: n, selected: n === initial.width }, `${n}×${n}`)))
      : null;
    sizeSel?.addEventListener("change", () => {
      const n = Number(sizeSel.value);
      target = { ...target, width: n, height: n };
      describe();
      redraw();
    });
    const modeShades = h("input", { type: "radio", name: "art-mode", checked: !trueColor });
    const modeColor = h("input", { type: "radio", name: "art-mode", checked: trueColor });
    const bright = h("input", { type: "range", min: -96, max: 96, step: 4, value: 0 });
    const brightRow = h("label", { class: "field" }, h("span", { class: "field-label" }, "Brightness"), bright);
    const use = h("button", { class: "btn primary", disabled: true }, "Use image");

    // a sheet of frames (menu icons) also plays, frame after frame
    let timer = 0;
    const redraw = () => {
      clearInterval(timer);
      preview.replaceChildren();
      brightRow.hidden = trueColor;
      use.disabled = !img;
      if (!img) return;
      const canvas = render(img, target, !trueColor, brightness);
      canvas.className = "art-canvas";
      preview.append(canvas);
      const frames = target.frames ?? 1;
      if (frames > 1) {
        const anim = h("canvas", { width: target.width, height: target.height, class: "art-canvas", title: "How it moves in the game" });
        const ctx = anim.getContext("2d")!;
        let f = 0;
        const show = () => {
          ctx.clearRect(0, 0, target.width, target.height);
          ctx.drawImage(canvas, 0, f * target.height, target.width, target.height, 0, 0, target.width, target.height);
          f = (f + 1) % frames;
        };
        show();
        timer = window.setInterval(show, 250);
        preview.append(anim);
      }
    };
    const take = async (f: File | undefined) => {
      if (!f) return;
      try {
        img = await loadFile(f);
        redraw();
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    };
    file.addEventListener("change", () => take(file.files?.[0]));
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      take(e.dataTransfer?.files[0]);
    });
    modeShades.addEventListener("change", () => {
      trueColor = false;
      redraw();
    });
    modeColor.addEventListener("change", () => {
      trueColor = true;
      redraw();
    });
    bright.addEventListener("input", () => {
      brightness = Number(bright.value);
      redraw();
    });
    const close = (result: ArtResult | null) => {
      clearInterval(timer);
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    use.addEventListener("click", () => {
      if (!img) return;
      close({ data: pngBytes(render(img, target, !trueColor, brightness)), trueColor, size: target.width });
    });
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });

    dialog.append(
      h("h3", {}, `Import ${target.label.toLowerCase()}`),
      info,
      ...(sizeSel ? [h("label", { class: "field" }, h("span", { class: "field-label" }, "Size in battle"), sizeSel)] : []),
      drop,
      file,
      preview,
      h(
        "div",
        { class: "art-modes" },
        h("label", {}, modeShades, " Game Boy 4 shades", h("span", { class: "hint" }, "Colored by the game's palettes, like the original sprites.")),
        h("label", {}, modeColor, " Full color", h("span", { class: "hint" }, "Shown exactly as drawn (trueColor). Applies to all of this one's images.")),
      ),
      brightRow,
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), use),
    );
    document.body.append(dialog);
    dialog.showModal();
    redraw();
  });
}

// A placeholder in the 4 shades: a plain silhouette with a question mark,
// drawn here (no ROM art), for new species until real art is imported.
export function placeholderArt(width: number, height: number, frames = 1): Uint8Array {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height * frames;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  for (let f = 0; f < frames; f++) {
    const y = f * height;
    const r = Math.max(3, Math.floor(Math.min(width, height) * 0.38));
    ctx.fillStyle = "#aaaaaa";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = Math.max(1, Math.round(width / 28));
    ctx.beginPath();
    ctx.arc(width / 2, y + height - r - 1, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#555555";
    ctx.font = `bold ${Math.round(r * 1.3)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", width / 2, y + height - r - 1);
  }
  // snap antialiasing back to the 4 shades
  const data = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = SHADES[Math.min(3, Math.floor(data.data[i] / 64))];
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return pngBytes(c);
}
