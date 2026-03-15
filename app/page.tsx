"use client";

import { useState, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────
interface SourceImage {
  id: string;
  name: string;
  file: File;
  preview: string;
}

interface ResultItem {
  promptIndex: number;
  prompt: string;
  status: "pending" | "loading" | "done" | "error";
  imageData?: string;
  mimeType?: string;
  error?: string;
}

interface ResultGroup {
  imageId: string;
  imageName: string;
  imagePreview: string;
  imageFile: File;
  results: ResultItem[];
}

type ImageMode = "upload" | "excel";

// ── Helpers ────────────────────────────────────────────
function parseCSVRows(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseCSVCols(text: string): string[] {
  const firstLine = text.split("\n")[0] || "";
  return firstLine
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function downloadImage(b64: string, mime: string, name: string) {
  const ext = mime.split("/")[1] || "png";
  const link = document.createElement("a");
  link.href = `data:${mime};base64,${b64}`;
  link.download = `${name}.${ext}`;
  link.click();
}

async function downloadAll(groups: ResultGroup[]) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const g of groups) {
    const folder = zip.folder(g.imageName.replace(/\.[^.]+$/, ""));
    for (const r of g.results) {
      if (r.status === "done" && r.imageData && r.mimeType) {
        const ext = r.mimeType.split("/")[1] || "png";
        folder?.file(`prompt_${String(r.promptIndex + 1).padStart(2, "0")}.${ext}`, r.imageData, { base64: true });
      }
    }
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "gemini_output.zip"; a.click();
  URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────
export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [imageMode, setImageMode] = useState<ImageMode>("upload");
  const [sourceImages, setSourceImages] = useState<SourceImage[]>([]);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelColumn, setExcelColumn] = useState("A");
  const [promptFile, setPromptFile] = useState<File | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [csvLayout, setCsvLayout] = useState<"rows" | "cols">("rows");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLog, setProgressLog] = useState("");
  const [groups, setGroups] = useState<ResultGroup[]>([]);
  const [dragImg, setDragImg] = useState(false);
  const [dragPrompt, setDragPrompt] = useState(false);

  const imgInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  // ── Image upload ──
  const addImages = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const newImgs: SourceImage[] = arr.map((f) => ({
      id: Math.random().toString(36).slice(2),
      name: f.name,
      file: f,
      preview: URL.createObjectURL(f),
    }));
    setSourceImages((prev) => [...prev, ...newImgs]);
  }, []);

  const removeImage = (id: string) =>
    setSourceImages((prev) => prev.filter((img) => img.id !== id));

  // ── Excel upload ──
  const handleExcel = async (file: File) => {
    setExcelFile(file);
  };

  // ── Prompt CSV upload ──
  const handlePromptFile = async (file: File) => {
    setPromptFile(file);
    const text = await file.text();
    const parsed = csvLayout === "rows" ? parseCSVRows(text) : parseCSVCols(text);
    setPrompts(parsed);
  };

  const refreshPrompts = async (layout: "rows" | "cols") => {
    if (!promptFile) return;
    const text = await promptFile.text();
    setPrompts(layout === "rows" ? parseCSVRows(text) : parseCSVCols(text));
  };

  // ── Generate ──
  const canRun =
    !!apiKey &&
    prompts.length > 0 &&
    (imageMode === "upload" ? sourceImages.length > 0 : !!excelFile);

  const run = async () => {
    abortRef.current = false;
    setRunning(true);
    setGroups([]);

    // Resolve image list
    let imageFiles: { name: string; file: File }[] = [];

    if (imageMode === "upload") {
      imageFiles = sourceImages.map((s) => ({ name: s.name, file: s.file }));
    } else {
      // Parse Excel for paths, then fetch images from local paths (not feasible server-side)
      // Instead: parse Excel on server, but since images are local paths we can't fetch them.
      // So for Excel mode: we'll read image paths from Excel and show instructions.
      // Better UX: just use direct upload. Excel mode reads paths but user must also upload those images.
      // Simplification: In Excel mode, parse Excel for filenames and match against uploaded images.
      // --- Actually for a web app, we read the excel for metadata and the user uploads the images too ---
      // For now, if Excel mode is selected, treat excelFile as a list and ask user to also upload images.
      // Simple approach: parse excel client-side using SheetJS
      try {
        const XLSX = await import("xlsx");
        const buf = await excelFile!.arrayBuffer();
        const wb = XLSX.read(buf, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
        const colIdx = excelColumn.toUpperCase().charCodeAt(0) - 65;
        const names = rows
          .slice(1)
          .map((r) => r[colIdx])
          .filter(Boolean)
          .map(String);

        if (names.length === 0) {
          alert(`Không tìm thấy dữ liệu trong cột ${excelColumn} của Excel.`);
          setRunning(false);
          return;
        }

        // Match by filename against uploaded images
        if (sourceImages.length === 0) {
          alert("Vui lòng upload ảnh ở tab 'Upload Ảnh' để ghép với danh sách trong Excel.");
          setRunning(false);
          return;
        }

        const nameMap = new Map(sourceImages.map((s) => [s.name.toLowerCase(), s]));
        for (const n of names) {
          const basename = n.split(/[\\/]/).pop()?.toLowerCase() || "";
          const match = nameMap.get(basename);
          if (match) imageFiles.push({ name: match.name, file: match.file });
        }

        if (imageFiles.length === 0) {
          alert("Không khớp tên ảnh nào giữa Excel và ảnh đã upload. Kiểm tra lại tên file.");
          setRunning(false);
          return;
        }
      } catch {
        alert("Không đọc được file Excel.");
        setRunning(false);
        return;
      }
    }

    const total = imageFiles.length * prompts.length;
    let done = 0;

    // Init groups
    const initGroups: ResultGroup[] = imageFiles.map((img) => ({
      imageId: Math.random().toString(36).slice(2),
      imageName: img.name,
      imagePreview: URL.createObjectURL(img.file),
      imageFile: img.file,
      results: prompts.map((p, i) => ({
        promptIndex: i,
        prompt: p,
        status: "pending",
      })),
    }));
    setGroups(initGroups);

    const updatedGroups = initGroups.map((g) => ({ ...g, results: [...g.results] }));

    for (let gi = 0; gi < updatedGroups.length; gi++) {
      if (abortRef.current) break;
      const group = updatedGroups[gi];

      for (let pi = 0; pi < prompts.length; pi++) {
        if (abortRef.current) break;

        setProgressLog(`Đang xử lý: ${group.imageName} — Prompt ${pi + 1}/${prompts.length}`);
        group.results[pi] = { ...group.results[pi], status: "loading" };
        setGroups(updatedGroups.map((g) => ({ ...g, results: [...g.results] })));

        try {
          const fd = new FormData();
          fd.append("image", imageFiles[gi].file);
          fd.append("prompt", prompts[pi]);
          fd.append("apiKey", apiKey);

          const res = await fetch("/api/generate", { method: "POST", body: fd });
          const data = await res.json();

          if (data.success) {
            group.results[pi] = {
              ...group.results[pi],
              status: "done",
              imageData: data.imageData,
              mimeType: data.mimeType,
            };
          } else {
            group.results[pi] = { ...group.results[pi], status: "error", error: data.error };
          }
        } catch (e: unknown) {
          group.results[pi] = {
            ...group.results[pi],
            status: "error",
            error: e instanceof Error ? e.message : "Lỗi không xác định",
          };
        }

        done++;
        setProgress(Math.round((done / total) * 100));
        setGroups(updatedGroups.map((g) => ({ ...g, results: [...g.results] })));

        // Small delay to avoid rate limit
        if (pi < prompts.length - 1) await new Promise((r) => setTimeout(r, 1500));
      }
    }

    setProgressLog("Hoàn thành!");
    setRunning(false);
  };

  const totalDone = groups.reduce((s, g) => s + g.results.filter((r) => r.status === "done").length, 0);
  const hasResults = groups.length > 0;

  return (
    <div className="page">
      <header>
        <div className="logo">
          <div className="logo-mark">✦</div>
          <div className="logo-text">Gemini Image<span>Studio</span></div>
        </div>
        <span className="badge">Batch Generator</span>
      </header>

      <main>
        {/* ── SIDEBAR ── */}
        <aside className="sidebar">

          {/* API KEY */}
          <div className="section">
            <div className="section-label">Gemini API Key</div>
            <div className="api-input-wrap">
              <input
                type="password"
                className="api-input"
                placeholder="AIza..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="api-hint">
              Lấy key tại{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com
              </a>
            </div>
          </div>

          {/* PROMPTS */}
          <div className="section">
            <div className="section-label">File Prompt (CSV)</div>
            <div className="layout-row">
              <span className="layout-label">Layout:</span>
              <div className="layout-btns">
                {(["rows", "cols"] as const).map((l) => (
                  <button
                    key={l}
                    className={`layout-btn ${csvLayout === l ? "active" : ""}`}
                    onClick={() => {
                      setCsvLayout(l);
                      refreshPrompts(l);
                    }}
                  >
                    {l === "rows" ? "8 dòng" : "8 cột"}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`dropzone ${dragPrompt ? "drag" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragPrompt(true); }}
              onDragLeave={() => setDragPrompt(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragPrompt(false);
                const f = e.dataTransfer.files[0];
                if (f) handlePromptFile(f);
              }}
              onClick={() => promptInputRef.current?.click()}
            >
              <input
                ref={promptInputRef}
                type="file"
                accept=".csv,.txt"
                style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.[0]) handlePromptFile(e.target.files[0]); }}
              />
              <div className="drop-icon">📄</div>
              <div className="drop-title">Upload file CSV / TXT</div>
              <div className="drop-sub">Kéo thả hoặc click để chọn</div>
            </div>

            {promptFile && (
              <div className="file-pill">
                <span className="name">✓ {promptFile.name}</span>
                <button onClick={() => { setPromptFile(null); setPrompts([]); }}>✕</button>
              </div>
            )}

            {prompts.length > 0 && (
              <div className="prompt-list">
                {prompts.map((p, i) => (
                  <div className="prompt-item" key={i}>
                    <span className="prompt-num">{i + 1}.</span>
                    <span className="prompt-text">{p}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* IMAGES */}
          <div className="section">
            <div className="section-label">Nguồn Ảnh</div>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${imageMode === "upload" ? "active" : ""}`}
                onClick={() => setImageMode("upload")}
              >
                ↑ Upload Ảnh
              </button>
              <button
                className={`toggle-btn ${imageMode === "excel" ? "active" : ""}`}
                onClick={() => setImageMode("excel")}
              >
                📊 Từ Excel
              </button>
            </div>

            {imageMode === "upload" ? (
              <>
                <div
                  className={`dropzone ${dragImg ? "drag" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragImg(true); }}
                  onDragLeave={() => setDragImg(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragImg(false);
                    addImages(e.dataTransfer.files);
                  }}
                  onClick={() => imgInputRef.current?.click()}
                >
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files) addImages(e.target.files); }}
                  />
                  <div className="drop-icon">🖼️</div>
                  <div className="drop-title">Upload ảnh</div>
                  <div className="drop-sub">JPG, PNG, WEBP · Nhiều file</div>
                </div>

                {sourceImages.length > 0 && (
                  <div className="image-grid">
                    {sourceImages.slice(0, 7).map((img) => (
                      <div className="thumb" key={img.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.preview} alt={img.name} />
                        <button className="rm" onClick={() => removeImage(img.id)}>✕</button>
                      </div>
                    ))}
                    {sourceImages.length > 7 && (
                      <div className="more-count">+{sourceImages.length - 7}</div>
                    )}
                  </div>
                )}
                {sourceImages.length > 0 && (
                  <div className="api-hint" style={{ marginTop: 8 }}>
                    {sourceImages.length} ảnh đã chọn
                  </div>
                )}
              </>
            ) : (
              <>
                <div
                  className="dropzone"
                  onClick={() => excelInputRef.current?.click()}
                >
                  <input
                    ref={excelInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files?.[0]) handleExcel(e.target.files[0]); }}
                  />
                  <div className="drop-icon">📊</div>
                  <div className="drop-title">Upload file Excel</div>
                  <div className="drop-sub">.xlsx · .xls</div>
                </div>

                {excelFile && (
                  <div className="file-pill">
                    <span className="name">✓ {excelFile.name}</span>
                    <button onClick={() => setExcelFile(null)}>✕</button>
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <div className="section-label" style={{ marginBottom: 6 }}>
                    Cột chứa đường dẫn ảnh
                  </div>
                  <input
                    className="api-input"
                    placeholder="A"
                    value={excelColumn}
                    onChange={(e) => setExcelColumn(e.target.value)}
                    maxLength={2}
                    style={{ width: 60 }}
                  />
                  <div className="api-hint" style={{ marginTop: 6 }}>
                    Cần upload thêm ảnh ở tab &ldquo;Upload Ảnh&rdquo; để khớp tên file
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* ── CONTENT ── */}
        <div className="content">
          {/* Run button */}
          {!running && !hasResults && (
            <button className="run-btn" disabled={!canRun} onClick={run}
              style={{ maxWidth: 320, margin: "0 auto 32px" }}>
              ✦ Bắt đầu Generate
            </button>
          )}

          {/* Progress */}
          {running && (
            <div className="progress-wrap">
              <div className="progress-header">
                <span className="progress-title">Đang xử lý...</span>
                <span className="progress-count">{progress}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-log">
                <div className="spinner" />
                {progressLog}
              </div>
            </div>
          )}

          {/* Download all */}
          {hasResults && !running && totalDone > 0 && (
            <div style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "center" }}>
              <button className="dl-all-btn" onClick={() => downloadAll(groups)}>
                ⬇ Tải tất cả (.zip)
              </button>
              <button
                className="run-btn"
                style={{ margin: 0, padding: "10px 18px", fontSize: 13 }}
                disabled={!canRun}
                onClick={run}
              >
                ↺ Chạy lại
              </button>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
                {totalDone} ảnh thành công
              </span>
            </div>
          )}

          {/* Empty state */}
          {!hasResults && !running && (
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              <div className="empty-title">Sẵn sàng generate</div>
              <div className="empty-sub">
                Upload ảnh + file prompt CSV,<br />nhập API key rồi nhấn &ldquo;Bắt đầu&rdquo;
              </div>
            </div>
          )}

          {/* Result groups */}
          {groups.map((group) => (
            <div className="result-group" key={group.imageId}>
              <div className="group-header">
                <div className="group-original">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={group.imagePreview} alt={group.imageName} />
                </div>
                <div>
                  <div className="group-name">{group.imageName}</div>
                  <div className="group-meta">
                    {group.results.filter((r) => r.status === "done").length}/{group.results.length} prompt
                  </div>
                </div>
              </div>

              <div className="result-grid">
                {group.results.map((result) => (
                  <div
                    className={`result-card ${result.status === "error" ? "error" : ""}`}
                    key={result.promptIndex}
                  >
                    {result.status === "done" && result.imageData ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="result-img"
                          src={`data:${result.mimeType};base64,${result.imageData}`}
                          alt={result.prompt}
                        />
                        <div className="result-footer">
                          <span className="result-label">P{result.promptIndex + 1}</span>
                          <button
                            className="dl-btn"
                            onClick={() =>
                              downloadImage(
                                result.imageData!,
                                result.mimeType!,
                                `${group.imageName.replace(/\.[^.]+$/, "")}_p${result.promptIndex + 1}`
                              )
                            }
                          >
                            ↓ tải
                          </button>
                        </div>
                      </>
                    ) : result.status === "loading" ? (
                      <div style={{ aspectRatio: "1", display: "grid", placeItems: "center" }}>
                        <div className="spinner" style={{ width: 24, height: 24 }} />
                      </div>
                    ) : result.status === "error" ? (
                      <div style={{ aspectRatio: "1", display: "grid", placeItems: "center" }}>
                        <div className="error-msg">{result.error}</div>
                      </div>
                    ) : (
                      <div style={{ aspectRatio: "1", background: "var(--surface2)" }}>
                        <div className="result-footer" style={{ border: "none" }}>
                          <span className="result-label" style={{ color: "var(--text-muted)" }}>
                            P{result.promptIndex + 1} · chờ...
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
