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

const MONO_FONT_STACK = "ui-monospace, SFMono-Regular, Menlo, monospace";
const CALIBRATION_FONT_SIZE = 64;
const GLYPH_CANVAS_SIZE = 96;

const DEFAULTS = {
  cols: 120,
  charsetIndex: 0,
  invert: false,
  gamma: 1.0,
  colorize: false,
  fontSize: 12,
};

const HERO_ASCII_TITLE = `
 ____  _                       _   _        ___                          _           _ 
/ ___|| |_ ___ _ __ ___  _ __ | |_| |__    |_ _|_ __ ___  _ __ ___   ___| |__   ___ | |
\___ \| __/ _ \ '_ \\ _ \\| '_ \\| __| '_ \\    | || '_ \\ _ \\| '_ \\ _ \\ / _ \\ '_ \\ / _ \\| |
 ___) | ||  __/ | | | | | |_) | |_| | | |   | || | | | | | | | | | |  __/ | | | (_) | |
|____/ \\__\\___|_| |_| |_| .__/ \\__|_| |_|  |___|_| |_| |_|_| |_| |_|\\___|_| |_|\\___/|_|
                        |_|                                                            
  ____                            _      ___                _      _             
 |  _ \\ ___ _ __ ___   ___ _ __  | |_   / _ \\__   _____  __(_) ___(_) ___  _ __  
 | |_) / _ \\ '_  _ \\ / _ \\ '_ \\ | __| | | | \\ \\ / / _ \\/ __| |/ __| |/ _ \\| '_ \\
 |  _ <  __/ | | | | |  __/ | | || |_  | |_| |\\ V /  __/ (__| | (__| | (_) | | | |
 |_| \\_\\___|_| |_| |_|\\___|_| |_| \\__|  \\___/  \\_/ \\___|\\___|_|\\___|_|\\___/|_| |_|
`.trim();

// Typical monospace character aspect ratio (height / width).
const CHAR_ASPECT = 2.0;

// Scratch buffers reused between conversions to reduce allocations/GC pressure.
const bufferCache = {
  brightness: null,
  quantized: null,
};

// Reuse a single canvas/context per conversion to avoid DOM churn.
const scratchCanvas = {
  canvas: null,
  ctx: null,
};

const glyphScratch = {
  canvas: null,
  ctx: null,
};

const charsetCalibrationCache = new Map();
const EMPTY_FLOAT32 = new Float32Array(0);

// Cache decoded images so repeated conversions (changing sliders) don't trigger re-decode.
const imageCache = new Map();

// Mime types that decode reliably across browsers/canvases in this preview
const SUPPORTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

export default function AsciiArtApp() {
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
  const [messengerFriendly, setMessengerFriendly] = useState(false);
  const [fontSize, setFontSize] = useState(DEFAULTS.fontSize);

  const conversionIdRef = useRef(0);
  const activeConversionRef = useRef(0);

  const [asciiText, setAsciiText] = useState("");
  const [asciiHtml, setAsciiHtml] = useState("");
  const [asciiCells, setAsciiCells] = useState([]);

  const [urlField, setUrlField] = useState("");
  const [isIphone, setIsIphone] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);

  const charsetInfo = useMemo(
    () => getCalibratedCharset(CHARSETS[charsetIndex].set),
    [charsetIndex],
  );
  const charset = charsetInfo.ramp;

  const rows = useMemo(() => {
    if (!imgMeta.w || !imgMeta.h || !cols) return 0;
    return Math.max(1, Math.round((imgMeta.h / imgMeta.w) * (cols / CHAR_ASPECT)));
  }, [imgMeta, cols]);

  const previewMinWidth = useMemo(() => `${Math.max(cols || 0, 1)}ch`, [cols]);
  const previewTextStyle = useMemo(
    () => ({
      fontFamily: MONO_FONT_STACK,
      fontSize: `${fontSize}px`,
      lineHeight: 1,
      minWidth: previewMinWidth,
    }),
    [fontSize, previewMinWidth],
  );

  const isMobileLayout = isIphone || isCompactViewport;

  // Clean up object URLs
  useEffect(
    () => () => {
      if (objectUrl) {
        releaseCachedImage(objectUrl);
        URL.revokeObjectURL(objectUrl);
      }
    },
    [objectUrl],
  );

  // Drag & Drop + overlay input wiring
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    const onDragOver = (e) => { e.preventDefault(); el.classList.add("ring-2", "ring-emerald-400"); };
    const onDragLeave = (e) => { e.preventDefault(); el.classList.remove("ring-2", "ring-emerald-400"); };
    const onDrop = (e) => {
      e.preventDefault(); el.classList.remove("ring-2", "ring-emerald-400");
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

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent || navigator.vendor || "";
    const isIphoneUA = /iPhone/.test(ua);
    const isTouchMac =
      /Mac/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 2;
    if (isIphoneUA) {
      setIsIphone(true);
      return;
    }
    if (typeof window !== "undefined" && isTouchMac) {
      const mq = window.matchMedia("(max-width: 820px)");
      setIsIphone(mq.matches);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 768px)");
    const handleChange = (event) => setIsCompactViewport(event.matches);
    setIsCompactViewport(mq.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handleChange);
      return () => mq.removeEventListener("change", handleChange);
    }
    mq.addListener(handleChange);
    return () => mq.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) {
      setMobileSettingsOpen(false);
      return;
    }
    if (imageUrl) {
      setMobileSettingsOpen(true);
    }
  }, [isMobileLayout, imageUrl]);

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
    setAsciiCells([]);
  }

  function clearImage() {
    if (objectUrl) {
      releaseCachedImage(objectUrl);
      URL.revokeObjectURL(objectUrl);
    }
    releaseCachedImage(imageUrl);
    setObjectUrl("");
    setImageUrl("");
    setImgMeta({ w: 0, h: 0 });
    resetAscii();
    activeConversionRef.current = 0;
  }

  function reportError(msg) {
    setError(msg);
    setTimeout(() => setError(""), 5000);
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
    releaseCachedImage(imageUrl);
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
      setError("");
      const clean = (raw || urlField).trim();
      if (!clean) return;
      // Fetch as blob to avoid CORS-tainted canvas
      const res = await fetch(clean, { mode: "cors" }).catch(() => fetch(clean, { mode: "no-cors" }));
      if (!res || (res.status && res.status >= 400)) throw new Error(`HTTP ${res?.status || "error"}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      releaseCachedImage(imageUrl);
      const meta = await loadImageMeta(url);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setObjectUrl(url);
      setImageUrl(url);
      setImgMeta(meta);
      await convertToAscii(url, meta.w, meta.h);
    } catch (e) {
      console.error(e);
      reportError("Couldn’t fetch that image URL. Tip: open it in a new tab and copy the direct image link.");
    }
  }

  async function convertToAscii(url, w, h) {
    if (!url || !w || !h) return;
    const jobId = conversionIdRef.current + 1;
    conversionIdRef.current = jobId;
    activeConversionRef.current = jobId;
    try {
      const result = await imageUrlToAscii({
        url,
        targetCols: cols,
        imgW: w,
        imgH: h,
        charset: charsetInfo,
        invert,
        gamma,
        colorize,
      });
      if (activeConversionRef.current !== jobId) {
        return;
      }
      setAsciiText(result.text);
      setAsciiHtml(result.html);
      setAsciiCells(result.cells);
    } catch (e) {
      console.error(e);
      if (activeConversionRef.current === jobId) {
        reportError("Conversion failed. Try a different image or smaller width.");
      }
    } finally {
      if (activeConversionRef.current === jobId) {
        activeConversionRef.current = 0;
      }
    }
  }

  function colorizedPreviewHtml(size, html, widthCh) {
    if (!html) return "";
    const family = MONO_FONT_STACK;
    const widthRule = widthCh ? ` min-width:${widthCh};` : "";
    return `<pre style="margin:0; font-family:${family}; font-size:${size}px; line-height:1; white-space:pre;${widthRule}">${html}</pre>`;
  }

  function formatForMessenger(text) {
    if (!text) return "";
    const figureSpace = "\u2007";
    const stabilized = text.replace(/ /g, figureSpace);
    return "```\n" + stabilized + "\n```";
  }

  function copyToClipboard() {
    if (!asciiText) return;
    if (messengerFriendly) {
      const payload = formatForMessenger(asciiText);
      if (!payload) return;
      navigator.clipboard
        .writeText(payload)
        .then(() => toast("Copied with messenger formatting 📱"))
        .catch(() => toast("Copy failed"));
      return;
    }
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
    if (!asciiText) return;
    const isHtml = !!colorize && !messengerFriendly;
    const plainTextData = messengerFriendly ? formatForMessenger(asciiText) : asciiText;
    const data = isHtml ? colorizedPreviewHtml(fontSize, asciiHtml, previewMinWidth) : plainTextData;
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

  function renderAsciiToCanvas({
    textColor,
    backgroundColor,
    targetWidth,
    targetHeight,
    scale = 1,
  }) {
    if (!asciiCells.length) return null;
    const rowCount = asciiCells.length;
    const colCount = asciiCells[0]?.length || 0;
    if (!rowCount || !colCount) return null;

    const fontFamily = MONO_FONT_STACK;
    const font = `${fontSize}px ${fontFamily}`;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.font = font;
    const metrics = ctx.measureText("M");
    const charWidth = metrics.width || fontSize * 0.6 || 1;
    const lineHeight = fontSize || 1;

    const baseWidth = Math.max(colCount * charWidth, 1);
    const baseHeight = Math.max(rowCount * lineHeight, 1);

    let scaleX = scale;
    let scaleY = scale;

    if (targetWidth) {
      const ratio = targetWidth / baseWidth;
      if (Number.isFinite(ratio) && ratio > 0) {
        scaleX = ratio;
      }
    }
    if (targetHeight) {
      const ratio = targetHeight / baseHeight;
      if (Number.isFinite(ratio) && ratio > 0) {
        scaleY = ratio;
      }
    }

    if (!Number.isFinite(scaleX) || scaleX <= 0) scaleX = 1;
    if (!Number.isFinite(scaleY) || scaleY <= 0) scaleY = 1;

    let finalWidth = Math.max(1, Math.round(baseWidth * scaleX));
    let finalHeight = Math.max(1, Math.round(baseHeight * scaleY));

    if (targetWidth) {
      finalWidth = Math.max(1, Math.round(targetWidth));
      scaleX = finalWidth / baseWidth;
    }
    if (targetHeight) {
      finalHeight = Math.max(1, Math.round(targetHeight));
      scaleY = finalHeight / baseHeight;
    }

    canvas.width = finalWidth;
    canvas.height = finalHeight;

    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.font = font;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    if (!colorize) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, baseWidth, baseHeight);
      ctx.fillStyle = textColor;
    } else if (backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, baseWidth, baseHeight);
    }

    for (let y = 0; y < rowCount; y++) {
      const row = asciiCells[y];
      for (let x = 0; x < colCount; x++) {
        const cell = row?.[x];
        if (!cell) continue;
        const posX = x * charWidth;
        const posY = y * lineHeight;

        if (colorize) {
          const { r, g, b } = cell;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(posX, posY, charWidth, lineHeight);
          const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          ctx.fillStyle = luminance > 0.6 ? "rgb(0,0,0)" : "rgb(255,255,255)";
        } else {
          ctx.fillStyle = textColor;
        }

        if (cell.char !== " " || colorize) {
          ctx.fillText(cell.char, posX, posY);
        }
      }
    }

    return canvas;
  }

  function downloadPng() {
    const canvas = renderAsciiToCanvas({ textColor: "#000000", backgroundColor: "#ffffff" });
    triggerCanvasDownload(canvas, "ascii-art.png");
  }

  function downloadOledPng() {
    const canvas = renderAsciiToCanvas({ textColor: "#ffffff", backgroundColor: "#000000" });
    triggerCanvasDownload(canvas, "ascii-art-oled.png");
  }

  function downloadFullResPng() {
    if (!imgMeta.w || !imgMeta.h) return;
    const canvas = renderAsciiToCanvas({
      textColor: "#000000",
      backgroundColor: "#ffffff",
      targetWidth: imgMeta.w,
      targetHeight: imgMeta.h,
    });
    triggerCanvasDownload(canvas, "ascii-art-full.png");
  }

  function triggerCanvasDownload(canvas, filename) {
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    }, "image/png");
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
    releaseCachedImage(imageUrl);
    loadImageMeta(url).then(meta => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setObjectUrl("");
      setImageUrl(url);
      setImgMeta(meta);
      convertToAscii(url, meta.w, meta.h);
    });
  }

  const actionButtonSizing = isMobileLayout ? "flex-1 min-w-[120px]" : "";
  const headerButtonBase = `wd-action ${actionButtonSizing}`;
  const settingsForm = (
    <>
      <div>
        <label className="flex justify-between items-center mb-1 text-sm">
          <span>Width (columns)</span>
          <span className="tabular-nums text-neutral-500">{cols}</span>
        </label>
        <input
          type="range"
          min={40}
          max={300}
          value={cols}
          onChange={(e) => setCols(parseInt(e.target.value))}
          className="w-full"
        />
      </div>

      <div>
        <label className="block mb-1 text-sm">Character set</label>
        <select
          value={charsetIndex}
          onChange={(e) => setCharsetIndex(parseInt(e.target.value))}
          className="wd-input w-full"
        >
          {CHARSETS.map((c, i) => (
            <option key={c.name} value={i}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="mt-1 text-xs text-neutral-500 truncate">{charset}</div>
        <p className="mt-1 text-xs text-neutral-500 leading-relaxed">
          Characters are automatically reordered by measured glyph brightness so shading matches the source image more closely.
        </p>
      </div>

      <div>
        <label className="flex justify-between items-center mb-1 text-sm">
          <span>Gamma</span>
          <span className="tabular-nums text-neutral-500">{gamma.toFixed(2)}</span>
        </label>
        <input
          type="range"
          min={0.4}
          max={2.2}
          step={0.01}
          value={gamma}
          onChange={(e) => setGamma(parseFloat(e.target.value))}
          className="w-full"
        />
        <p className="text-xs text-neutral-500 mt-1">Lower = brighter mids, Higher = darker mids</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Invert brightness
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={colorize} onChange={(e) => setColorize(e.target.checked)} /> Colorize
        </label>
        <label
          className="inline-flex items-center gap-2"
          title="Formats copies/downloads with figure spaces and triple backticks for WhatsApp/iMessage."
        >
          <input
            type="checkbox"
            checked={messengerFriendly}
            onChange={(e) => setMessengerFriendly(e.target.checked)}
          />
          Messenger-friendly (WhatsApp/iMessage)
        </label>
      </div>

      <div>
        <label className="flex justify-between items-center mb-1 text-sm">
          <span>Font size</span>
          <span className="tabular-nums text-neutral-500">{fontSize}px</span>
        </label>
        <input
          type="range"
          min={8}
          max={32}
          value={fontSize}
          onChange={(e) => setFontSize(parseInt(e.target.value))}
          className="w-full"
        />
      </div>

      <div className="pt-2">
        <label className="block mb-1 text-sm">Import by direct image URL</label>
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://example.com/picture.jpg"
            value={urlField}
            onChange={(e) => setUrlField(e.target.value)}
            className="wd-input flex-1"
          />
          <button
            onClick={() => importFromUrl()}
            className={`wd-action ${isMobileLayout ? "min-w-[120px]" : ""}`}
            data-tone="cyan"
          >
            Load
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400/70">We download as a blob to keep the canvas untainted.</p>
      </div>

      <div className="pt-1 text-xs text-neutral-500 leading-relaxed">
        <p>
          <strong>Tips:</strong>{" "}
          {isMobileLayout ? "Tap Upload to open your camera or photo library. " : "Paste with ⌘/Ctrl+V. "}
          Big widths (200–300) look sharper but render slower. If your iPhone photo is HEIC, export as JPEG/PNG first
          (screenshot also works). Enable Messenger-friendly for WhatsApp/iMessage-safe spacing inside a monospace code block.
        </p>
      </div>
    </>
  );

  return (
    <div className="wd-app-shell min-h-screen w-full text-slate-100">
      <header className="wd-hero sticky top-0 z-20">
        <div className="wd-hero__grid" aria-hidden />
        <div className="wd-hero__noise" aria-hidden />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          <div className="max-w-2xl space-y-4">
            <div className="wd-hero__eyebrow">ASCII.CONSOLE // WATCH_DOGS SIGNAL</div>
            <h1 className="wd-hero__title">
              <span className="sr-only">Signal intercepted. Render images as ASCII.</span>
              <div className="wd-hero__title-frame" aria-hidden="true">
                <pre>{HERO_ASCII_TITLE}</pre>
              </div>
            </h1>
            <p className="wd-hero__subtitle">
              Jack into a monochrome grid inspired by DedSec. Feed it screenshots, photos, or glitch captures—then export razor-sharp ASCII payloads for terminals, chats, or OLED wallpapers.
            </p>
            <div className="wd-hero__ascii">
              <pre>{`01000001 01010011 01000011 01001001 01001001\n>> decode.frame(signal);`}</pre>
            </div>
          </div>
          <div
            className={`relative flex flex-wrap gap-2.5 ${
              isMobileLayout ? "w-full" : "justify-end"
            }`}
          >
            <button
              onClick={copyToClipboard}
              disabled={!asciiText}
              className={headerButtonBase}
              data-tone="slate"
            >
              Copy
            </button>
            <button
              onClick={downloadFile}
              disabled={!asciiText}
              className={headerButtonBase}
              data-tone="slate"
            >
              Download
            </button>
            <button
              onClick={downloadPng}
              disabled={!asciiCells.length}
              className={headerButtonBase}
              data-tone="cyan"
            >
              Download PNG
            </button>
            <button
              onClick={downloadFullResPng}
              disabled={!asciiCells.length || !imgMeta.w || !imgMeta.h}
              className={headerButtonBase}
              data-tone="indigo"
            >
              Download PNG (Full Res)
            </button>
            <button
              onClick={downloadOledPng}
              disabled={!asciiCells.length}
              className={headerButtonBase}
              data-tone="emerald"
            >
              Download OLED PNG
            </button>
            <label className={`${headerButtonBase} cursor-pointer`} data-tone="violet">
              Upload
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={onFileChange}
                onClick={(e) => {
                  e.target.value = null;
                }}
              />
            </label>
          </div>
        </div>
      </header>

      <main
        className={`mx-auto max-w-6xl px-4 py-10 ${
          isMobileLayout ? "flex flex-col gap-8" : "grid grid-cols-1 lg:grid-cols-5 gap-8"
        }`}
      >
        {/* Dropzone / Preview */}
        <section className={isMobileLayout ? "w-full" : "lg:col-span-3"}>
          <div
            ref={dropRef}
            className={`wd-panel--inset relative overflow-hidden rounded-3xl transition ${
              isMobileLayout ? "p-6 min-h-[240px]" : "p-8 min-h-[320px]"
            }`}
          >
            {/* Full-area invisible input overlay for bulletproof tapping/clicking on mobile */}
            {!imageUrl && (
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="absolute inset-0 opacity-0 cursor-pointer"
                title=""
                onChange={onFileChange}
                onClick={(e) => { e.target.value = null; }}
              />
            )}

            {!imageUrl ? (
              <div className="pointer-events-none text-center">
                <div className="wd-panel__header mb-4">Input channel idle</div>
                <div className="text-4xl sm:text-5xl font-semibold tracking-[0.4em] text-cyan-200/70">
                  ▛▞▚▚▞▟
                </div>
                <p className="mt-4 text-sm text-slate-300/80">
                  {isMobileLayout
                    ? "Tap Upload above or anywhere inside this field to jack in a photo or snap a shot."
                    : "Drop, paste, or click to uplink an image. Clipboard intercepts with ⌘/Ctrl+V are armed."}
                </p>
                <p className="mt-3 text-xs uppercase tracking-[0.3em] text-slate-400/70">
                  PNG • JPG • WEBP • GIF • BMP
                </p>
                <div className="mt-5 flex justify-center">
                  <button onClick={loadDemo} className="pointer-events-auto wd-action" data-tone="cyan">
                    Load Demo Signal
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full">
                <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-400/70">
                  <div>Image: {imgMeta.w}×{imgMeta.h}px</div>
                  <button onClick={clearImage} className="text-cyan-200 hover:text-cyan-100">Clear</button>
                </div>
                <div className="wd-panel rounded-2xl">
                  <div className="max-h-[60vh] overflow-x-auto overflow-y-auto p-4 sm:p-5">
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
              <div className="mt-3 text-xs uppercase tracking-[0.3em] text-rose-300/80">{error}</div>
            )}
          </div>
        </section>

        {/* Controls */}
        {isMobileLayout ? (
          <section className="lg:col-span-2">
            <details
              className="wd-panel rounded-3xl"
              open={mobileSettingsOpen}
              onToggle={(event) => setMobileSettingsOpen(event.target.open)}
            >
              <summary className="flex items-center justify-between gap-2 px-4 py-3 text-base font-semibold cursor-pointer select-none [&::-webkit-details-marker]:hidden">
                <span className="uppercase tracking-[0.3em] text-slate-300/80">Settings</span>
                <span className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">{mobileSettingsOpen ? "Hide" : "Show"}</span>
              </summary>
              <div className="border-t border-slate-700/50 px-4 pb-4 pt-4 sm:px-6 space-y-5">
                {settingsForm}
              </div>
            </details>
          </section>
        ) : (
          <section className="lg:col-span-2">
            <div className="wd-panel rounded-3xl p-4 sm:p-6 space-y-5">
              <h2 className="text-lg font-semibold uppercase tracking-[0.3em] text-slate-300/80">Settings</h2>
              {settingsForm}
            </div>
          </section>
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-12 text-xs wd-footer">
        Built for fun. All processing stays in your browser.
      </footer>
    </div>
  );
}

async function imageUrlToAscii({ url, targetCols, imgW, imgH, charset, invert, gamma, colorize }) {
  // Compute target rows using aspect compensation
  const rows = Math.max(1, Math.round((imgH / imgW) * (targetCols / CHAR_ASPECT)));

  const { canvas, ctx } = getScratchContext(targetCols, rows);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const img = await loadImageCached(url);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const ramp = charset?.ramp || "";
  const levels = charset?.levels || EMPTY_FLOAT32;
  const hasRamp = ramp.length > 0;
  if (!hasRamp) {
    return { text: "", html: "", cells: [] };
  }
  const n = ramp.length;
  const lines = [];
  const htmlLines = [];
  const cells = new Array(rows);

  function bright(r, g, b) {
    let v = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    v = Math.min(1, Math.max(0, Math.pow(v, gamma)));
    if (invert) v = 1 - v;
    return v;
  }

  const totalPixels = rows * targetCols;
  const { brightness, quantized } = acquireAsciiBuffers(totalPixels);
  brightness.fill(0);
  quantized.fill(0);

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

  if (n <= 1) {
    // No ramp variance: all pixels map to the single available glyph.
    quantized.fill(0);
    const fillValue = levels[0] ?? 0;
    brightness.fill(fillValue);
  } else {
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < targetCols; x++) {
        const idx = y * targetCols + x;
        const oldPixel = brightness[idx];
        const { index: qIdx, value: newPixel } = quantizeToLevels(oldPixel, levels);
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
    const rowCells = new Array(targetCols);
    for (let x = 0; x < targetCols; x++) {
      const idx = y * targetCols + x;
      const dataIdx = idx * 4;
      const r = data[dataIdx + 0];
      const g = data[dataIdx + 1];
      const b = data[dataIdx + 2];
      const i = n > 1 ? quantized[idx] : 0;
      const ch = ramp[i];
      rowTxt += ch;
      rowCells[x] = { char: ch, r, g, b };
      if (colorize) {
        const glyph = ch === " " ? "&nbsp;" : escapeHtml(ch);
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const textRgb = luminance > 0.6 ? "rgb(0,0,0)" : "rgb(255,255,255)";
        rowHtml += `<span style="display:inline-block;width:1ch;height:1em;background-color: rgb(${r},${g},${b});color:${textRgb};font-family:inherit;">${glyph}</span>`;
      }
    }
    lines.push(rowTxt);
    if (colorize) htmlLines.push(rowHtml);
    cells[y] = rowCells;
  }

  const text = lines.join("\n");
  const html = colorize ? htmlLines.join("\n") : "";
  return { text, html, cells };
}

function acquireAsciiBuffers(size) {
  if (!bufferCache.brightness || bufferCache.brightness.length < size) {
    bufferCache.brightness = new Float32Array(size);
    bufferCache.quantized = new Uint16Array(size);
  }
  return {
    brightness: bufferCache.brightness.subarray(0, size),
    quantized: bufferCache.quantized.subarray(0, size),
  };
}

function getScratchContext(width, height) {
  if (!scratchCanvas.canvas) {
    scratchCanvas.canvas = document.createElement("canvas");
    scratchCanvas.ctx = scratchCanvas.canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!scratchCanvas.ctx) {
    throw new Error("Canvas context unavailable");
  }
  if (scratchCanvas.canvas.width !== width || scratchCanvas.canvas.height !== height) {
    scratchCanvas.canvas.width = width;
    scratchCanvas.canvas.height = height;
  }
  return scratchCanvas;
}

function getGlyphContext() {
  if (!glyphScratch.canvas) {
    glyphScratch.canvas = document.createElement("canvas");
    glyphScratch.canvas.width = GLYPH_CANVAS_SIZE;
    glyphScratch.canvas.height = GLYPH_CANVAS_SIZE;
    glyphScratch.ctx = glyphScratch.canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!glyphScratch.ctx) {
    throw new Error("Canvas context unavailable");
  }
  if (glyphScratch.canvas.width !== GLYPH_CANVAS_SIZE || glyphScratch.canvas.height !== GLYPH_CANVAS_SIZE) {
    glyphScratch.canvas.width = GLYPH_CANVAS_SIZE;
    glyphScratch.canvas.height = GLYPH_CANVAS_SIZE;
  }
  const { ctx } = glyphScratch;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${CALIBRATION_FONT_SIZE}px ${MONO_FONT_STACK}`;
  return glyphScratch;
}

function loadImageCached(url) {
  if (!url) return Promise.reject(new Error("Missing image URL"));
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => {
      imageCache.delete(url);
      reject(err);
    };
    img.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

async function loadImageMeta(url) {
  const img = await loadImageCached(url);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  return { w, h };
}

function releaseCachedImage(url) {
  if (!url) return;
  imageCache.delete(url);
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getCalibratedCharset(chars) {
  const safeChars = typeof chars === "string" ? chars : String(chars ?? "");
  if (!safeChars) {
    return { ramp: "", levels: EMPTY_FLOAT32, raw: "" };
  }
  if (charsetCalibrationCache.has(safeChars)) {
    return charsetCalibrationCache.get(safeChars);
  }
  const calibration = typeof document === "undefined" ? createUniformCharset(safeChars) : calibrateCharset(safeChars);
  charsetCalibrationCache.set(safeChars, calibration);
  return calibration;
}

function createUniformCharset(chars) {
  const ramp = chars;
  if (!ramp.length) {
    return { ramp: "", levels: EMPTY_FLOAT32, raw: chars };
  }
  const levels = new Float32Array(ramp.length);
  if (ramp.length === 1) {
    levels[0] = 0;
  } else {
    const denom = ramp.length - 1;
    for (let i = 0; i < ramp.length; i++) {
      levels[i] = i / denom;
    }
  }
  return { ramp, levels, raw: chars };
}

function calibrateCharset(chars) {
  const uniqueChars = Array.from(new Set([...chars]));
  if (!uniqueChars.length) {
    return createUniformCharset(chars);
  }
  const { canvas, ctx } = getGlyphContext();
  const entries = [];
  for (const ch of uniqueChars) {
    const brightness = measureCharBrightness(ctx, ch, canvas.width, canvas.height);
    entries.push({ ch, brightness });
  }
  entries.sort((a, b) => a.brightness - b.brightness);
  if (!entries.length) {
    return createUniformCharset(chars);
  }
  const ramp = entries.map((entry) => entry.ch).join("");
  const min = entries[0].brightness;
  const max = entries[entries.length - 1].brightness;
  const range = Math.max(1e-6, max - min);
  const levels = new Float32Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const normalized = range === 0 ? 0 : (entries[i].brightness - min) / range;
    levels[i] = normalized;
  }
  return { ramp, levels, raw: chars };
}

function measureCharBrightness(ctx, ch, width, height) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (ch !== " ") {
    ctx.fillStyle = "#000000";
    ctx.fillText(ch, width / 2, height / 2);
  }
  const { data } = ctx.getImageData(0, 0, width, height);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const pixels = (data.length / 4) || 1;
  return sum / (pixels * 255);
}

function quantizeToLevels(value, levels) {
  const n = levels.length;
  if (n === 0) {
    return { index: 0, value: 0 };
  }
  if (n === 1) {
    return { index: 0, value: levels[0] };
  }
  if (value <= levels[0]) {
    return { index: 0, value: levels[0] };
  }
  const lastIndex = n - 1;
  if (value >= levels[lastIndex]) {
    return { index: lastIndex, value: levels[lastIndex] };
  }
  let lo = 0;
  let hi = lastIndex;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (value >= levels[mid]) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const lowVal = levels[lo];
  const highVal = levels[hi];
  if (value - lowVal <= highVal - value) {
    return { index: lo, value: lowVal };
  }
  return { index: hi, value: highVal };
}
