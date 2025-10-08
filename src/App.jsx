import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * ASCII Art Image App — v2 "Bulletproof Uploads"
 * -------------------------------------------------------
 * Now supports:
 *  - Click to upload (robust label/input)
 *  - Drag & drop (with full-area invisible input overlay)
 *  - Paste from clipboard (⌘/Ctrl+V)
 *  - Import by URL (downloads as blob to avoid CORS taint)
 *  - Camera capture on mobile (capture="environment")
 *  - Friendly HEIC/HEIF handling message
 *
 * Converts any supported image to ASCII art in-browser.
 */

const CHARSETS = [
  { name: "Classic (10)", set: " .:-=+*#%@" },
  { name: "Detailed (70)", set: " .'`\"^,;:Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" },
  { name: "Blocks", set: " ░▒▓█" },
  { name: "Dense", set: " .,:;ox%#@" },
  { name: "Sharp", set: " `-~+*^=/#$@" },
];

const DEFAULTS = {
  cols: 120,
  charsetIndex: 0,
  invert: false,
  gamma: 1.0,
  colorize: false,
  fontSize: 12,
};

// Typical monospace character aspect ratio (height / width).
const CHAR_ASPECT = 2.0;

// Mime types that decode reliably across browsers/canvases in this preview
const SUPPORTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

export default function AsciiArtApp() {
  const fileInputRef = useRef(null);
  const overlayInputRef = useRef(null);
  const dropRef = useRef(null);

  const [imageUrl, setImageUrl] = useState("");
  const [objectUrl, setObjectUrl] = useState("");
  const [imgMeta, setImgMeta] = useState({ w: 0, h: 0 });
  const [error, setError] = useState("");

  const [cols, setCols] = useState(DEFAULTS.cols);
  const [charsetIndex, setCharsetIndex] = useState(DEFAULTS.charsetIndex);
  const [invert, setInvert] = useState(DEFAULTS.invert);
  const [gamma, setGamma] = useState(DEFAULTS.gamma);
  const [colorize, setColorize] = useState(DEFAULTS.colorize);
  const [fontSize, setFontSize] = useState(DEFAULTS.fontSize);
  const [busy, setBusy] = useState(false);

  const [asciiText, setAsciiText] = useState("");
  const [asciiHtml, setAsciiHtml] = useState("");

  const [urlField, setUrlField] = useState("");

  const charset = useMemo(() => CHARSETS[charsetIndex].set, [charsetIndex]);

  const rows = useMemo(() => {
    if (!imgMeta.w || !imgMeta.h || !cols) return 0;
    return Math.max(1, Math.round((imgMeta.h / imgMeta.w) * (cols / CHAR_ASPECT)));
  }, [imgMeta, cols]);

  const previewMinWidth = useMemo(() => `${Math.max(cols || 0, 1)}ch`, [cols]);
  const previewTextStyle = useMemo(
    () => ({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: `${fontSize}px`,
      lineHeight: 1,
      minWidth: previewMinWidth,
    }),
    [fontSize, previewMinWidth],
  );

  // Clean up object URLs
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  // Drag & Drop + overlay input wiring
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    const onDragOver = (e) => { e.preventDefault(); el.classList.add("ring-2","ring-indigo-500"); };
    const onDragLeave = (e) => { e.preventDefault(); el.classList.remove("ring-2","ring-indigo-500"); };
    const onDrop = (e) => {
      e.preventDefault(); el.classList.remove("ring-2","ring-indigo-500");
      const files = e.dataTransfer?.files; if (files && files.length) handleFiles(files);
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, []);

  // Paste support
  useEffect(() => {
    function onPaste(e) {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) { handleFiles([file]); e.preventDefault(); return; }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Re-render ASCII when settings change and an image is loaded
  useEffect(() => {
    if (!imageUrl || !imgMeta.w || !imgMeta.h) return;
    const id = setTimeout(() => convertToAscii(imageUrl, imgMeta.w, imgMeta.h), 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, charset, invert, gamma, colorize]);

  function resetAscii() {
    setAsciiText("");
    setAsciiHtml("");
  }

  function clearImage() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl("");
    setImageUrl("");
    setImgMeta({ w: 0, h: 0 });
    resetAscii();
  }

  function reportError(msg) {
    setError(msg);
    setTimeout(() => setError(""), 5000);
  }

  function handlePick() {
    fileInputRef.current?.click();
  }

  function onFileChange(e) {
    const files = e.target.files;
    // reset value so choosing the same file again still triggers change
    e.target.value = null;
    if (files && files.length) handleFiles(files);
  }

  function handleFiles(fileList) {
    const file = fileList[0];
    if (!file) return;

    // HEIC/HEIF guidance
    const type = file.type || "";
    const lowerName = (file.name || "").toLowerCase();
    const looksHeic = type.includes("heic") || type.includes("heif") || lowerName.endsWith(".heic") || lowerName.endsWith(".heif");
    if (looksHeic) {
      reportError("HEIC/HEIF isn’t reliably supported here. Please export as JPG/PNG (e.g., share → Save as JPEG, or take a screenshot).");
      // We still try to decode; if it fails, the user will see the error already.
    }

    // Some environments don’t populate type for security; still proceed.
    if (type && !SUPPORTED_TYPES.has(type) && !looksHeic) {
      reportError(`Unsupported file type: ${type}. Try JPG/PNG/WEBP.`);
    }

    // Read via object URL
    const url = URL.createObjectURL(file);
    loadImageMeta(url)
      .then((meta) => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setObjectUrl(url);
        setImageUrl(url);
        setImgMeta(meta);
        convertToAscii(url, meta.w, meta.h);
      })
      .catch((err) => {
        URL.revokeObjectURL(url);
        console.error(err);
        reportError("Couldn’t load that image. Try a different file.");
      });
  }

  async function importFromUrl(raw) {
    try {
      setBusy(true);
      setError("");
      const clean = (raw || urlField).trim();
      if (!clean) return;
      // Fetch as blob to avoid CORS-tainted canvas
      const res = await fetch(clean, { mode: "cors" }).catch(() => fetch(clean, { mode: "no-cors" }));
      if (!res || (res.status && res.status >= 400)) throw new Error(`HTTP ${res?.status || "error"}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const meta = await loadImageMeta(url);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setObjectUrl(url);
      setImageUrl(url);
      setImgMeta(meta);
      await convertToAscii(url, meta.w, meta.h);
    } catch (e) {
      console.error(e);
      reportError("Couldn’t fetch that image URL. Tip: open it in a new tab and copy the direct image link.");
    } finally {
      setBusy(false);
    }
  }

  async function convertToAscii(url, w, h) {
    if (!url || !w || !h) return;
    setBusy(true);
    try {
      const result = await imageUrlToAscii({
        url,
        targetCols: cols,
        imgW: w,
        imgH: h,
        charset,
        invert,
        gamma,
        colorize,
      });
      setAsciiText(result.text);
      setAsciiHtml(result.html);
    } catch (e) {
      console.error(e);
      reportError("Conversion failed. Try a different image or smaller width.");
    } finally {
      setBusy(false);
    }
  }

  function colorizedPreviewHtml(size, html, widthCh) {
    if (!html) return "";
    const family = "ui-monospace, SFMono-Regular, Menlo, monospace";
    const widthRule = widthCh ? ` min-width:${widthCh};` : "";
    return `<pre style="margin:0; font-family:${family}; font-size:${size}px; line-height:1; white-space:pre;${widthRule}">${html}</pre>`;
  }

  function copyToClipboard() {
    if (!asciiText) return;
    if (colorize && asciiHtml) {
      const htmlPayload = colorizedPreviewHtml(fontSize, asciiHtml, previewMinWidth);
      const blob = new Blob([htmlPayload], { type: "text/html" });
      const item = new ClipboardItem({ "text/html": blob });
      navigator.clipboard.write([item])
        .then(() => toast("HTML copied ✨"))
        .catch(async () => {
          await navigator.clipboard.writeText(asciiText);
          toast("Plain text copied (HTML fallback)");
        });
    } else {
      navigator.clipboard.writeText(asciiText).then(() => toast("Copied!"));
    }
  }

  function downloadFile() {
    const isHtml = !!colorize;
    const data = isHtml ? colorizedPreviewHtml(fontSize, asciiHtml, previewMinWidth) : asciiText;
    if (!data) return;
    const mime = isHtml ? "text/html" : "text/plain";
    const ext = isHtml ? "html" : "txt";
    const blob = new Blob([data], { type: mime + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ascii-art.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.className = "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-black text-white px-3 py-2 rounded-xl shadow-lg text-sm";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  function loadDemo() {
    // Tiny inline sample (data URL) to verify rendering works
    const demo =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJ"+
      "bWFnZVJlYWR5ccllPAAABQhJREFUeNrsW8ly2zYQvsqC6x7Qw8h0oYwqgQmVQ0eX5r8iP7Q3kR3Y0s3sQv0hC6l5cYj8V3HqU0EoGm"+
      "..."; // truncated; only used to show the UI path — not strictly needed
    // We’ll just skip using a massive base64. Instead, generate a simple gradient on a canvas:
    const c = document.createElement('canvas');
    c.width = 240; c.height = 160; const g = c.getContext('2d');
    const grd = g.createLinearGradient(0,0,240,160); grd.addColorStop(0,'#111'); grd.addColorStop(1,'#ddd');
    g.fillStyle = grd; g.fillRect(0,0,240,160);
    const url = c.toDataURL('image/png');
    loadImageMeta(url).then(meta => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setObjectUrl("");
      setImageUrl(url);
      setImgMeta(meta);
      convertToAscii(url, meta.w, meta.h);
    });
  }

  return (
    <div className="min-h-screen w-full bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-black/40 border-b border-neutral-200/60 dark:border-neutral-800/60">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-semibold">ASCII Art Image App</h1>
          <div className="flex gap-2">
            <button onClick={copyToClipboard} disabled={!asciiText} className="px-3 py-2 rounded-2xl bg-neutral-900 text-white disabled:opacity-40">Copy</button>
            <button onClick={downloadFile} disabled={!asciiText} className="px-3 py-2 rounded-2xl bg-neutral-200 dark:bg-neutral-800">Download</button>
            <label className="px-3 py-2 rounded-2xl bg-indigo-600 text-white cursor-pointer">
              Upload
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={onFileChange}
                onClick={(e) => { e.target.value = null; }}
              />
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Dropzone / Preview */}
        <section className="lg:col-span-3">
          <div
            ref={dropRef}
            className="relative border border-dashed rounded-3xl p-6 sm:p-8 border-neutral-300 dark:border-neutral-700 min-h-[260px] hover:bg-neutral-100/40 dark:hover:bg-neutral-900/40 transition"
          >
            {/* Full-area invisible input overlay for bulletproof tapping/clicking on mobile */}
            <input
              ref={overlayInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="absolute inset-0 opacity-0 cursor-pointer"
              title=""
              onChange={onFileChange}
              onClick={(e) => { e.target.value = null; }}
            />

            {!imageUrl ? (
              <div className="text-center pointer-events-none">
                <div className="text-5xl mb-2">🖼️➡️🔠</div>
                <p className="text-base">Drop, paste, click, or tap anywhere to choose an image</p>
                <p className="text-sm text-neutral-500 mt-2">PNG / JPG / WEBP / GIF / BMP • Paste with ⌘/Ctrl+V • Or use an image URL below</p>
                <div className="mt-3">
                  <button onClick={loadDemo} className="pointer-events-auto px-3 py-2 rounded-2xl bg-neutral-200 dark:bg-neutral-800">Try a demo</button>
                </div>
              </div>
            ) : (
              <div className="w-full">
                <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
                  <div>Image: {imgMeta.w}×{imgMeta.h}px</div>
                  <button onClick={clearImage} className="underline">Clear</button>
                </div>
                <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black">
                  <div className="max-h-[60vh] overflow-x-auto overflow-y-auto p-3">
                    {colorize ? (
                      <div
                        style={previewTextStyle}
                        dangerouslySetInnerHTML={{ __html: colorizedPreviewHtml(fontSize, asciiHtml, previewMinWidth) }}
                      />
                    ) : (
                      <pre
                        style={previewTextStyle}
                        className="whitespace-pre"
                      >{asciiText}</pre>
                    )}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</div>
            )}
          </div>
        </section>

        {/* Controls */}
        <section className="lg:col-span-2">
          <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 p-4 sm:p-6 bg-white dark:bg-neutral-950 shadow-sm space-y-5">
            <h2 className="text-lg font-semibold">Settings</h2>

            <div>
              <label className="flex justify-between items-center mb-1 text-sm"><span>Width (columns)</span><span className="tabular-nums text-neutral-500">{cols}</span></label>
              <input type="range" min={40} max={300} value={cols} onChange={(e) => setCols(parseInt(e.target.value))} className="w-full" />
            </div>

            <div>
              <label className="block mb-1 text-sm">Character set</label>
              <select value={charsetIndex} onChange={(e) => setCharsetIndex(parseInt(e.target.value))} className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent p-2">
                {CHARSETS.map((c, i) => (
                  <option key={c.name} value={i}>{c.name}</option>
                ))}
              </select>
              <div className="mt-1 text-xs text-neutral-500 truncate">{charset}</div>
            </div>

            <div>
              <label className="flex justify-between items-center mb-1 text-sm"><span>Gamma</span><span className="tabular-nums text-neutral-500">{gamma.toFixed(2)}</span></label>
              <input type="range" min={0.4} max={2.2} step={0.01} value={gamma} onChange={(e) => setGamma(parseFloat(e.target.value))} className="w-full" />
              <p className="text-xs text-neutral-500 mt-1">Lower = brighter mids, Higher = darker mids</p>
            </div>

            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Invert brightness</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={colorize} onChange={(e) => setColorize(e.target.checked)} /> Colorize</label>
            </div>

            <div>
              <label className="flex justify-between items-center mb-1 text-sm"><span>Font size</span><span className="tabular-nums text-neutral-500">{fontSize}px</span></label>
              <input type="range" min={8} max={32} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full" />
            </div>

            {/* URL Import */}
            <div className="pt-2">
              <label className="block mb-1 text-sm">Import by direct image URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://example.com/picture.jpg"
                  value={urlField}
                  onChange={(e) => setUrlField(e.target.value)}
                  className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent p-2"
                />
                <button onClick={() => importFromUrl()} className="px-3 py-2 rounded-2xl bg-neutral-200 dark:bg-neutral-800">Load</button>
              </div>
              <p className="text-xs text-neutral-500 mt-1">We download as a blob to keep the canvas untainted.</p>
            </div>

            <div className="pt-1 text-xs text-neutral-500 leading-relaxed">
              <p><strong>Tips:</strong> Paste with ⌘/Ctrl+V. Big widths (200–300) look sharper but render slower. If your iPhone photo is HEIC, export as JPEG/PNG first (screenshot also works).</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-neutral-500">
        Built for fun. All processing stays in your browser.
      </footer>
    </div>
  );
}

async function imageUrlToAscii({ url, targetCols, imgW, imgH, charset, invert, gamma, colorize }) {
  // Compute target rows using aspect compensation
  const rows = Math.max(1, Math.round((imgH / imgW) * (targetCols / CHAR_ASPECT)));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = targetCols;
  canvas.height = rows;

  const img = await loadImage(url);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const ramp = charset;
  const n = ramp.length;
  const lines = [];
  const htmlLines = [];

  function bright(r, g, b) {
    let v = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    v = Math.min(1, Math.max(0, Math.pow(v, gamma)));
    if (invert) v = 1 - v;
    return v;
  }

  const totalPixels = rows * targetCols;
  const brightness = new Float32Array(totalPixels);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < targetCols; x++) {
      const idx = y * targetCols + x;
      const dataIdx = idx * 4;
      const r = data[dataIdx + 0];
      const g = data[dataIdx + 1];
      const b = data[dataIdx + 2];
      brightness[idx] = bright(r, g, b);
    }
  }

  const quantized = new Uint16Array(totalPixels);

  if (n <= 1) {
    // No ramp variance: all pixels map to the single available glyph.
    quantized.fill(0);
    brightness.fill(0);
  } else {
    const maxIndex = n - 1;
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < targetCols; x++) {
        const idx = y * targetCols + x;
        const oldPixel = brightness[idx];
        const qIdx = Math.round(oldPixel * maxIndex);
        const newPixel = qIdx / maxIndex;
        const error = oldPixel - newPixel;

        brightness[idx] = newPixel;
        quantized[idx] = qIdx;

        if (x + 1 < targetCols) {
          const east = idx + 1;
          brightness[east] = clamp01(brightness[east] + error * (7 / 16));
        }
        if (y + 1 < rows) {
          const south = idx + targetCols;
          brightness[south] = clamp01(brightness[south] + error * (5 / 16));
          if (x > 0) {
            const southwest = south - 1;
            brightness[southwest] = clamp01(brightness[southwest] + error * (3 / 16));
          }
          if (x + 1 < targetCols) {
            const southeast = south + 1;
            brightness[southeast] = clamp01(brightness[southeast] + error * (1 / 16));
          }
        }
      }
    }
  }

  for (let y = 0; y < rows; y++) {
    let rowTxt = "";
    let rowHtml = "";
    for (let x = 0; x < targetCols; x++) {
      const idx = y * targetCols + x;
      const dataIdx = idx * 4;
      const r = data[dataIdx + 0];
      const g = data[dataIdx + 1];
      const b = data[dataIdx + 2];
      const i = n > 1 ? quantized[idx] : 0;
      const ch = ramp[i];
      rowTxt += ch;
      if (colorize) {
        const glyph = ch === " " ? "&nbsp;" : escapeHtml(ch);
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const textRgb = luminance > 0.6 ? "rgb(0,0,0)" : "rgb(255,255,255)";
        rowHtml += `<span style="display:inline-block;width:1ch;height:1em;background-color: rgb(${r},${g},${b});color:${textRgb};font-family:inherit;">${glyph}</span>`;
      }
    }
    lines.push(rowTxt);
    if (colorize) htmlLines.push(rowHtml);
  }

  const text = lines.join("\n");
  const html = colorize ? htmlLines.join("\n") : "";
  return { text, html };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // For object URLs/data URLs CORS is irrelevant. For remote URLs, we fetched as blob.
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function loadImageMeta(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = reject;
    img.src = url;
  });
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
