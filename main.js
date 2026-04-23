"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");

// ─── Paths ───────────────────────────────────────────────────────────────────
const USER_DATA = app.getPath("userData"); // %APPDATA%\Saver 98
const DATA_FILE = path.join(USER_DATA, "saver98-data.json");
const RECEIPTS_DIR = path.join(USER_DATA, "receipts");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function parseDataUrl(dataUrl) {
  const match = /^data:(.+?);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function extensionForMime(mimeType) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/gif": ".gif",
    "image/tiff": ".tif",
  };
  return map[String(mimeType || "").toLowerCase()] || ".png";
}

function getOcrInfoScript() {
  return `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }
$payload = @{ ok = $true; languages = @($langs) } | ConvertTo-Json -Compress
Write-Output $payload
`.trim();
}

function runWindowsOcr(imagePath, languageTag) {
  const escapedPath = String(imagePath).replace(/'/g, "''");
  const escapedLang = String(languageTag || "").replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]

$script:AsTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
} | Select-Object -First 1

function AwaitOp($asyncOp, $type) {
  $method = $script:AsTaskGeneric.MakeGenericMethod($type)
  return $method.Invoke($null, @($asyncOp)).GetAwaiter().GetResult()
}

$file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${escapedPath}')) ([Windows.Storage.StorageFile])
$stream = AwaitOp ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
$decoder = AwaitOp ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = AwaitOp ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = $null
if ('${escapedLang}') {
  $lang = [Windows.Globalization.Language]::new('${escapedLang}')
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
}
if ($null -eq $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
if ($null -eq $engine) { throw "Windows OCR engine is unavailable." }
$result = AwaitOp ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output $result.Text
`.trim();

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `OCR process failed with code ${code}`));
        return;
      }
      resolve(stdout.replace(/^\uFEFF/, "").trim());
    });
    child.stdin.end(script);
  });
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell failed with code ${code}`));
        return;
      }
      resolve(stdout.replace(/^\uFEFF/, "").trim());
    });
    child.stdin.end(script);
  });
}

// ─── Auto-updater ────────────────────────────────────────────────────────────
function initAutoUpdater() {
  // Safety: don't run updater in dev, tests, or unpackaged mode
  if (!app.isPackaged) return;
  if (process.env.NODE_ENV === "development") return;
  if (process.env.SV98_DISABLE_AUTO_UPDATE === "1") return;

  // Safety defaults
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Quiet logs for troubleshooting without disrupting users
  autoUpdater.on("error", (err) => {
    console.warn("[updater] error:", err?.message || err);
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] update available:", info?.version || "unknown");
    // Start download only after availability is confirmed
    autoUpdater.downloadUpdate().catch((e) => {
      console.warn("[updater] download error:", e?.message || e);
    });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] no updates");
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] update downloaded:", info?.version || "unknown");
    // Install safely on next quit (default behavior with autoInstallOnAppQuit=true)
    // If you want immediate install UX later, wire this to renderer confirmation first.
  });

  // Delay check slightly so app startup isn't blocked
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.warn("[updater] check error:", e?.message || e);
    });
  }, 5000);
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, "assets", "icon.ico");

  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: "Saver 98",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: "#008080", // Win98 teal — visible before page loads
    autoHideMenuBar: true, // hide default Electron menu bar
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile("index.html");

  // Open DevTools in dev mode: set NODE_ENV=development
  if (process.env.NODE_ENV === "development") {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

/** Load all persisted data from disk. Returns null if no file yet. */
ipcMain.handle("sv98:load", () => {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    console.error("[main] load error:", e.message);
    return null;
  }
});

/** Save all data to disk. */
ipcMain.handle("sv98:save", (_e, data) => {
  try {
    ensureDir(USER_DATA);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("[main] save error:", e.message);
    return false;
  }
});

/**
 * [LEGACY — v0.1 only] Save a receipt image (base64) to the receipts folder.
 * As of v0.2 the renderer stores images directly in IndexedDB (browser-side).
 * These handlers are kept so that any v0.1 data that was synced via window.api
 * can still be read/written without crashing; they are no longer called by the
 * current renderer under normal operation.
 */
ipcMain.handle("sv98:saveReceipt", (_e, base64Data, originalName) => {
  try {
    ensureDir(RECEIPTS_DIR);
    const safeName =
      Date.now() +
      "_" +
      path.basename(originalName).replace(/[^a-z0-9._-]/gi, "_");
    const dest = path.join(RECEIPTS_DIR, safeName);
    fs.writeFileSync(dest, Buffer.from(base64Data, "base64"));
    return { ok: true, name: safeName, path: dest };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/** [LEGACY — v0.1 only] Load a receipt image and return as base64. */
ipcMain.handle("sv98:loadReceipt", (_e, filename) => {
  try {
    const p = path.join(RECEIPTS_DIR, filename);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p).toString("base64");
  } catch {
    return null;
  }
});

/** Return app version. */
ipcMain.handle("sv98:version", () => app.getVersion());

/** Return available native OCR languages on the host. */
ipcMain.handle("sv98:ocrInfo", async () => {
  if (process.platform !== "win32") {
    return { ok: true, languages: [] };
  }
  try {
    const raw = await runPowerShell(getOcrInfoScript());
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[ocr] info error:", e?.message || e);
    return { ok: false, languages: [], error: e?.message || "OCR info failed." };
  }
});

/** Run OCR against an image data URL using native Windows OCR. */
ipcMain.handle("sv98:ocrImage", async (_e, dataUrl, options = {}) => {
  if (process.platform !== "win32") {
    return { ok: false, error: "OCR is currently available only on Windows." };
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    return { ok: false, error: "Invalid image payload." };
  }

  const tempPath = path.join(
    app.getPath("temp") || os.tmpdir(),
    `sv98-ocr-${Date.now()}${extensionForMime(parsed.mimeType)}`,
  );

  try {
    fs.writeFileSync(tempPath, parsed.buffer);
    const text = await runWindowsOcr(tempPath, options.languageTag);
    return { ok: true, text };
  } catch (e) {
    console.warn("[ocr] error:", e?.message || e);
    return { ok: false, error: e?.message || "OCR failed." };
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (e) {
      console.warn("[ocr] temp cleanup error:", e?.message || e);
    }
  }
});

/** Show native save dialog and write a file. */
ipcMain.handle("sv98:exportFile", async (_e, suggestedName, content) => {
  const ext = path.extname(suggestedName).replace(".", "");
  const filters =
    ext === "csv"
      ? [
          { name: "CSV Files", extensions: ["csv"] },
          { name: "All Files", extensions: ["*"] },
        ]
      : [
          { name: "JSON Files", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ];

  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName,
    filters,
  });
  if (result.canceled || !result.filePath) return null;

  try {
    fs.writeFileSync(result.filePath, content, "utf8");
    return result.filePath;
  } catch (e) {
    return null;
  }
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDir(RECEIPTS_DIR);
  createWindow();
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
