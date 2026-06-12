import * as React from "react";
import { useState, useRef } from "react";
import {
  Upload,
  Download,
  Copy,
  Columns3,
  Rows3,
  ZoomIn,
  ZoomOut,
  Check,
  AlertCircle,
} from "lucide-react";
// @ts-ignore
import sewingMachineImg from "./assets/images/sewing_machine_illustration_1781252620847.jpg";

interface StitchItem {
  id: string;
  name: string;
  src: string;
  imgElement: HTMLImageElement;
  naturalWidth: number;
  naturalHeight: number;
  cropT: number;
  cropB: number;
  cropL: number;
  cropR: number;
}

const PREVIEW_W = 480;
const PREVIEW_H = 360;
const MIN_VIS = 0.05;

export default function App() {
  const [images, setImages] = useState<StitchItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [stitchMode, setStitchMode] = useState<"vertical" | "horizontal">("vertical");
  const [zoomLevel, setZoomLevel] = useState<number>(0.9);
  const [statusMsg, setStatusMsg] = useState<{ text: string; mode: "ok" | "err" | "" }>({ text: "", mode: "" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropDragRef = useRef<{
    imageId: string;
    edge: "top" | "bottom" | "left" | "right";
    startX: number;
    startY: number;
    startVal: number;
    fullW: number;
    fullH: number;
  } | null>(null);

  /* ── File loading ── */
  const handleFiles = (files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith("image/"));
    if (!valid.length) return;
    const slots = 15 - images.length;
    valid.slice(0, slots).forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const item: StitchItem = {
          id: Math.random().toString(36).slice(2),
          name: file.name.replace(/\.[^/.]+$/, "").slice(0, 30),
          src: url,
          imgElement: img,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          cropT: 0, cropB: 0, cropL: 0, cropR: 0,
        };
        setImages((prev) => {
          const next = [...prev, item];
          if (next.length === 1) setSelectedId(item.id);
          return next;
        });
      };
      img.src = url;
    });
  };

  /* ── Global paste ── */
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith("image/"));
      if (!items.length) return;
      items.forEach((item, idx) => {
        const blob = item.getAsFile();
        if (blob) handleFiles([new File([blob], `Pasted ${idx + 1}`, { type: blob.type })]);
      });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [images]);

  /* ── Delete / clear ── */
  const deleteImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
    if (selectedId === id) {
      setSelectedId(images.find((img) => img.id !== id)?.id ?? null);
    }
  };

  const clearAll = () => {
    images.forEach((img) => URL.revokeObjectURL(img.src));
    setImages([]);
    setSelectedId(null);
    setStatusMsg({ text: "", mode: "" });
  };

  /* ── Sidebar drag-reorder ── */
  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setImages((curr) => {
      const from = curr.findIndex((i) => i.id === draggedId);
      const to = curr.findIndex((i) => i.id === targetId);
      if (from === -1 || to === -1) return curr;
      const copy = [...curr];
      const [removed] = copy.splice(from, 1);
      copy.splice(to, 0, removed);
      return copy;
    });
  };

  /* ── Geometry ── */
  const getGeom = (item: StitchItem) => {
    const nw = item.naturalWidth, nh = item.naturalHeight;
    const visW = nw * (1 - item.cropL - item.cropR);
    const visH = nh * (1 - item.cropT - item.cropB);
    if (stitchMode === "vertical") {
      const s = PREVIEW_W / visW;
      return { blockW: PREVIEW_W, blockH: visH * s, fullW: nw * s, fullH: nh * s, offL: item.cropL * nw * s, offT: item.cropT * nh * s };
    } else {
      const s = PREVIEW_H / visH;
      return { blockW: visW * s, blockH: PREVIEW_H, fullW: nw * s, fullH: nh * s, offL: item.cropL * nw * s, offT: item.cropT * nh * s };
    }
  };

  /* ── Crop handle mouse/touch ── */
  const startCropDrag = (
    e: React.MouseEvent | React.TouchEvent,
    imageId: string,
    edge: "top" | "bottom" | "left" | "right",
    item: StitchItem
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(imageId);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const geom = getGeom(item);
    let startVal = edge === "top" ? item.cropT : edge === "bottom" ? item.cropB : edge === "left" ? item.cropL : item.cropR;
    cropDragRef.current = { imageId, edge, startX: clientX, startY: clientY, startVal, fullW: geom.fullW, fullH: geom.fullH };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!cropDragRef.current) return;
      const { edge, startX, startY, startVal, imageId, fullW, fullH } = cropDragRef.current;
      const cx = "touches" in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = "touches" in ev ? ev.touches[0].clientY : ev.clientY;
      // Divide by zoomLevel so drag speed matches screen pixels
      const dx = (cx - startX) / zoomLevel;
      const dy = (cy - startY) / zoomLevel;
      setImages((curr) =>
        curr.map((img) => {
          if (img.id !== imageId) return img;
          const u = { ...img };
          if (edge === "top")    u.cropT = Math.max(0, Math.min(1 - img.cropB - MIN_VIS, startVal + dy / fullH));
          if (edge === "bottom") u.cropB = Math.max(0, Math.min(1 - img.cropT - MIN_VIS, startVal - dy / fullH));
          if (edge === "left")   u.cropL = Math.max(0, Math.min(1 - img.cropR - MIN_VIS, startVal + dx / fullW));
          if (edge === "right")  u.cropR = Math.max(0, Math.min(1 - img.cropL - MIN_VIS, startVal - dx / fullW));
          return u;
        })
      );
    };
    const onUp = () => {
      cropDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  };

  /* ── Canvas build ── */
  const buildCanvas = (): HTMLCanvasElement | null => {
    if (!images.length) return null;
    const canvas = offscreenCanvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    if (stitchMode === "vertical") {
      const baseW = images[0].naturalWidth * (1 - images[0].cropL - images[0].cropR);
      let totalH = 0;
      const specs = images.map((item) => {
        const cw = item.naturalWidth * (1 - item.cropL - item.cropR);
        const ch = item.naturalHeight * (1 - item.cropT - item.cropB);
        const s = baseW / cw;
        const dh = ch * s;
        const spec = { img: item.imgElement, sx: item.cropL * item.naturalWidth, sy: item.cropT * item.naturalHeight, sw: cw, sh: ch, dx: 0, dy: totalH, dw: baseW, dh };
        totalH += dh;
        return spec;
      });
      canvas.width = baseW; canvas.height = totalH;
      ctx.clearRect(0, 0, baseW, totalH);
      specs.forEach((s) => ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, s.dx, s.dy, s.dw, s.dh));
    } else {
      const baseH = images[0].naturalHeight * (1 - images[0].cropT - images[0].cropB);
      let totalW = 0;
      const specs = images.map((item) => {
        const cw = item.naturalWidth * (1 - item.cropL - item.cropR);
        const ch = item.naturalHeight * (1 - item.cropT - item.cropB);
        const s = baseH / ch;
        const dw = cw * s;
        const spec = { img: item.imgElement, sx: item.cropL * item.naturalWidth, sy: item.cropT * item.naturalHeight, sw: cw, sh: ch, dx: totalW, dy: 0, dw, dh: baseH };
        totalW += dw;
        return spec;
      });
      canvas.width = totalW; canvas.height = baseH;
      ctx.clearRect(0, 0, totalW, baseH);
      specs.forEach((s) => ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, s.dx, s.dy, s.dw, s.dh));
    }
    return canvas;
  };

  const handleDownload = () => {
    if (!images.length) return;
    setStatusMsg({ text: "Stitching…", mode: "" });
    requestAnimationFrame(() => {
      try {
        const c = buildCanvas();
        if (!c) throw new Error("Canvas failed");
        c.toBlob((blob) => {
          if (!blob) throw new Error("Render failed");
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `stitched-${Date.now()}.png`;
          a.click();
          setStatusMsg({ text: "Saved ✓", mode: "ok" });
          setTimeout(() => setStatusMsg({ text: "", mode: "" }), 3000);
        }, "image/png");
      } catch (err) {
        setStatusMsg({ text: err instanceof Error ? err.message : "Error", mode: "err" });
      }
    });
  };

  const handleCopy = () => {
    if (!images.length) return;
    setStatusMsg({ text: "Copying…", mode: "" });
    requestAnimationFrame(() => {
      try {
        const c = buildCanvas();
        if (!c) throw new Error("Canvas failed");
        c.toBlob(async (blob) => {
          if (!blob) throw new Error("Render failed");
          try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            setStatusMsg({ text: "Copied ✓", mode: "ok" });
            setTimeout(() => setStatusMsg({ text: "", mode: "" }), 3000);
          } catch {
            setStatusMsg({ text: "Clipboard blocked — use Download", mode: "err" });
          }
        }, "image/png");
      } catch (err) {
        setStatusMsg({ text: err instanceof Error ? err.message : "Error", mode: "err" });
      }
    });
  };

  /* ── Render ── */
  return (
    <div
      className="h-screen bg-tactile text-[#2D2926] flex flex-col font-sans select-none relative overflow-hidden"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files) handleFiles(Array.from(e.dataTransfer.files)); }}
    >
      {/* ── Header ── */}
      <header className="px-6 py-3 bg-[#FDFCFB]/95 border-b border-[#2D2926]/10 backdrop-blur-md flex items-center justify-between shrink-0 z-10 sticky top-0">
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-serif font-black tracking-tighter text-[#2D2926]">STITCH</span>
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#2D2926]/50 font-bold">EST. 2026</span>
          </div>
          <span className="text-[10px] text-[#2D2926]/50 uppercase tracking-[0.15em] border-l border-[#2D2926]/10 pl-4 ml-1 hidden sm:inline font-semibold">
            {stitchMode === "vertical" ? "Vertical" : "Horizontal"} Stitch · Crop · Align
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <div className="text-[10px] text-[#7C8B7E] tracking-[0.1em] uppercase px-3 py-1.5 border border-[#7C8B7E]/20 bg-[#F5F2ED] hidden md:block font-bold">
            Local only · no uploads
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-1.5 border border-[#2D2926] text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-[#2D2926] hover:text-[#FDFCFB] transition-all cursor-pointer"
          >
            Add Photos
          </button>
        </div>
        <input
          ref={fileInputRef} type="file" className="hidden" accept="image/*" multiple
          onChange={(e) => { if (e.target.files) handleFiles(Array.from(e.target.files)); e.target.value = ""; }}
        />
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar: thumbnail grid ── */}
        <aside className="w-52 bg-[#FDFCFB] border-r border-[#2D2926]/10 flex flex-col shrink-0 overflow-hidden">
          {/* Upload zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="mx-3 mt-3 mb-2 border border-dashed border-[#2D2926]/20 p-3 flex flex-col items-center gap-1 cursor-pointer hover:border-[#2D2926]/50 hover:bg-[#F5F2ED]/40 transition-all shrink-0"
          >
            <Upload className="w-5 h-5 text-[#7C8B7E]" />
            <span className="font-serif italic text-xs text-[#2D2926]/70">Add Photos</span>
          </div>

          {images.length > 0 && (
            <div className="px-3 py-1 flex items-center justify-between shrink-0">
              <span className="text-[9px] font-bold text-[#2D2926]/40 uppercase tracking-widest">Queue</span>
              <span className="text-[9px] font-mono text-[#2D2926]/40">{images.length}/15</span>
            </div>
          )}

          {/* Thumbnail grid */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3">
            {images.length === 0 ? (
              <p className="text-center text-[10px] text-[#2D2926]/30 italic font-serif mt-6">
                No images yet
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {images.map((item, index) => {
                  const isSelected = item.id === selectedId;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      draggable
                      onDragStart={(e) => { setDraggedId(item.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => setDraggedId(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); handleDrop(item.id); }}
                      className={`relative group cursor-pointer aspect-square overflow-hidden transition-all duration-150 ${
                        draggedId === item.id ? "opacity-30 scale-95" : ""
                      }`}
                      style={{
                        outline: isSelected ? "2px solid #F97316" : "2px solid transparent",
                        outlineOffset: "1px",
                      }}
                    >
                      <img
                        src={item.src} alt=""
                        className="w-full h-full object-cover pointer-events-none"
                        referrerPolicy="no-referrer"
                      />
                      {/* Number badge */}
                      <span className="absolute bottom-0.5 left-0.5 text-[8px] font-bold font-mono text-white bg-black/50 px-1 leading-4 select-none">
                        {index + 1}
                      </span>
                      {/* Delete button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteImage(item.id); }}
                        className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 text-white text-[10px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full leading-none select-none"
                        title="Remove"
                      >×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {images.length > 0 && (
            <div className="p-3 border-t border-[#2D2926]/10 shrink-0">
              <button
                onClick={clearAll}
                className="w-full py-2 border border-[#2D2926]/20 text-[9px] font-bold uppercase tracking-widest text-[#2D2926]/50 hover:text-[#2D2926] hover:border-[#2D2926]/50 transition-all cursor-pointer"
              >
                Clear All
              </button>
            </div>
          )}
        </aside>

        {/* ── Preview canvas ── */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          <div className="flex-1 overflow-auto bg-workspace p-8 flex justify-center items-start custom-scrollbar relative">
            <div
              className="origin-top"
              style={{ transform: `scale(${zoomLevel})`, transition: "transform 0.1s ease-out" }}
            >
              {images.length === 0 ? (
                /* Welcome / empty state */
                <div className="flex flex-col items-center justify-center min-h-[480px] p-12 text-center bg-[#FDFCFB] border border-[#2D2926]/10 max-w-xl shadow-lg">
                  <div className="mb-6 border border-[#2D2926]/10 bg-white p-4">
                    <img
                      src={sewingMachineImg} alt="Sewing machine"
                      className="w-72 h-auto opacity-90 mx-auto"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <h2 className="text-4xl font-serif text-[#2D2926] leading-tight mb-3">
                    Precision in <br />
                    <span className="italic text-[#7C8B7E]">Every Stitch.</span>
                  </h2>
                  <p className="text-xs text-[#2D2926]/60 mb-6 font-semibold">
                    Drag & drop, click Add Photos, or paste (⌘V)
                  </p>
                  <div className="flex gap-2 text-[9px] font-bold tracking-wider text-[#2D2926]/40">
                    {["JPG", "PNG", "WEBP", "GIF"].map((f) => (
                      <span key={f} className="border border-[#2D2926]/10 px-2 py-1">{f}</span>
                    ))}
                  </div>
                </div>
              ) : (
                /* Image blocks */
                <div className={`flex ${stitchMode === "vertical" ? "flex-col" : "flex-row"}`}>
                  {images.map((item, index) => {
                    const geom = getGeom(item);
                    const isSelected = item.id === selectedId;

                    return (
                      <div key={item.id} className={`flex ${stitchMode === "vertical" ? "flex-col" : "flex-row"}`}>
                        {index > 0 && (
                          <div style={{
                            width: stitchMode === "horizontal" ? "1px" : "100%",
                            height: stitchMode === "vertical" ? "1px" : "100%",
                            background: "rgba(45,41,38,0.1)",
                            flexShrink: 0,
                          }} />
                        )}

                        {/* Image block */}
                        <div
                          onClick={(e) => { e.stopPropagation(); setSelectedId(item.id); }}
                          className="relative shrink-0 overflow-hidden group cursor-pointer transition-all duration-200"
                          style={{
                            width: geom.blockW,
                            height: geom.blockH,
                            boxShadow: isSelected
                              ? "0 0 0 3px #F97316, 0 0 22px 5px rgba(249,115,22,0.32), 0 0 50px 10px rgba(249,115,22,0.12)"
                              : "0 2px 12px rgba(45,41,38,0.1)",
                            zIndex: isSelected ? 2 : 1,
                          }}
                        >
                          <img
                            src={item.src} alt=""
                            className="absolute pointer-events-none max-w-none"
                            style={{ width: geom.fullW, height: geom.fullH, left: -geom.offL, top: -geom.offT }}
                            referrerPolicy="no-referrer"
                          />

                          {/* Crop % badge */}
                          <div className="absolute top-2 right-2 bg-black/60 text-white font-mono text-[9px] px-1.5 py-0.5 select-none pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                            {Math.round((1 - item.cropL - item.cropR) * 100)}% × {Math.round((1 - item.cropT - item.cropB) * 100)}%
                          </div>

                          {/* Double-click hint */}
                          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/55 text-white font-sans text-[9px] px-2 py-0.5 select-none pointer-events-none whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                            Dbl-click edge to reset crop
                          </div>

                          {/* ── Crop handles ── */}
                          {/* Top */}
                          <div
                            onMouseDown={(e) => startCropDrag(e, item.id, "top", item)}
                            onTouchStart={(e) => startCropDrag(e, item.id, "top", item)}
                            onDoubleClick={() => setImages((c) => c.map((i) => i.id === item.id ? { ...i, cropT: 0 } : i))}
                            className="absolute top-0 left-0 right-0 flex items-center justify-center transition-all"
                            style={{
                              height: 14,
                              cursor: "ns-resize",
                              background: isSelected ? "rgba(249,115,22,0.45)" : "rgba(45,41,38,0.15)",
                              opacity: isSelected ? 1 : 0,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = isSelected ? "1" : "0"; }}
                          >
                            <div className="w-8 h-1 bg-white/80 rounded-full pointer-events-none" />
                          </div>

                          {/* Bottom */}
                          <div
                            onMouseDown={(e) => startCropDrag(e, item.id, "bottom", item)}
                            onTouchStart={(e) => startCropDrag(e, item.id, "bottom", item)}
                            onDoubleClick={() => setImages((c) => c.map((i) => i.id === item.id ? { ...i, cropB: 0 } : i))}
                            className="absolute bottom-0 left-0 right-0 flex items-center justify-center transition-all"
                            style={{
                              height: 14,
                              cursor: "ns-resize",
                              background: isSelected ? "rgba(249,115,22,0.45)" : "rgba(45,41,38,0.15)",
                              opacity: isSelected ? 1 : 0,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = isSelected ? "1" : "0"; }}
                          >
                            <div className="w-8 h-1 bg-white/80 rounded-full pointer-events-none" />
                          </div>

                          {/* Left */}
                          <div
                            onMouseDown={(e) => startCropDrag(e, item.id, "left", item)}
                            onTouchStart={(e) => startCropDrag(e, item.id, "left", item)}
                            onDoubleClick={() => setImages((c) => c.map((i) => i.id === item.id ? { ...i, cropL: 0 } : i))}
                            className="absolute top-0 bottom-0 left-0 flex items-center justify-center transition-all"
                            style={{
                              width: 14,
                              cursor: "ew-resize",
                              background: isSelected ? "rgba(249,115,22,0.45)" : "rgba(45,41,38,0.15)",
                              opacity: isSelected ? 1 : 0,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = isSelected ? "1" : "0"; }}
                          >
                            <div className="w-1 h-8 bg-white/80 rounded-full pointer-events-none" />
                          </div>

                          {/* Right */}
                          <div
                            onMouseDown={(e) => startCropDrag(e, item.id, "right", item)}
                            onTouchStart={(e) => startCropDrag(e, item.id, "right", item)}
                            onDoubleClick={() => setImages((c) => c.map((i) => i.id === item.id ? { ...i, cropR: 0 } : i))}
                            className="absolute top-0 bottom-0 right-0 flex items-center justify-center transition-all"
                            style={{
                              width: 14,
                              cursor: "ew-resize",
                              background: isSelected ? "rgba(249,115,22,0.45)" : "rgba(45,41,38,0.15)",
                              opacity: isSelected ? 1 : 0,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = isSelected ? "1" : "0"; }}
                          >
                            <div className="w-1 h-8 bg-white/80 rounded-full pointer-events-none" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Floating controls */}
            {images.length > 0 && (
              <>
                {/* Mode toggle: top-left */}
                <button
                  onClick={() => setStitchMode((p) => p === "vertical" ? "horizontal" : "vertical")}
                  className="absolute top-4 left-4 z-20 w-10 h-10 border border-[#2D2926] bg-[#FDFCFB] hover:bg-[#2D2926] text-[#2D2926] hover:text-[#FDFCFB] flex items-center justify-center shadow-sm transition-all cursor-pointer"
                  title="Toggle stitch direction"
                >
                  {stitchMode === "vertical" ? <Rows3 className="w-4 h-4" /> : <Columns3 className="w-4 h-4" />}
                </button>

                {/* Zoom: bottom-right */}
                <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 border border-[#2D2926]/15 bg-[#FDFCFB] py-1.5 px-3 shadow-md">
                  <button onClick={() => setZoomLevel((p) => Math.max(0.3, p - 0.1))} className="p-0.5 hover:bg-[#F5F2ED] transition-colors cursor-pointer">
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="range" min="30" max="200" value={Math.round(zoomLevel * 100)}
                    onChange={(e) => setZoomLevel(parseFloat(e.target.value) / 100)}
                    className="w-20 accent-[#F97316] cursor-pointer h-1 appearance-none bg-[#2D2926]/10 rounded-lg"
                  />
                  <button onClick={() => setZoomLevel((p) => Math.min(2, p + 0.1))} className="p-0.5 hover:bg-[#F5F2ED] transition-colors cursor-pointer">
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] font-bold font-mono w-8 text-right">{Math.round(zoomLevel * 100)}%</span>
                </div>
              </>
            )}
          </div>

          {/* Action bar */}
          <div className="px-5 py-4 bg-[#F5F2ED] border-t border-[#2D2926]/10 flex items-center gap-3 shrink-0">
            <button
              onClick={handleCopy}
              disabled={images.length === 0}
              className="px-5 py-2 border border-[#2D2926] bg-transparent hover:bg-[#2D2926] text-[#2D2926] hover:text-[#FDFCFB] disabled:opacity-30 disabled:pointer-events-none text-[11px] font-bold tracking-[0.15em] uppercase transition-all cursor-pointer flex items-center gap-2"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Image
            </button>
            <button
              onClick={handleDownload}
              disabled={images.length === 0}
              className="px-5 py-2 border border-[#2D2926] bg-[#2D2926] hover:bg-[#2D2926]/85 text-[#FDFCFB] disabled:opacity-30 disabled:pointer-events-none text-[11px] font-bold tracking-[0.15em] uppercase transition-all cursor-pointer flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              Download PNG
            </button>
            <span className={`text-[11px] ml-auto font-bold uppercase tracking-wider flex items-center gap-1.5 ${
              statusMsg.mode === "ok" ? "text-[#7C8B7E]" : statusMsg.mode === "err" ? "text-red-500" : "text-[#2D2926]/40"
            }`}>
              {statusMsg.mode === "ok" && <Check className="w-3.5 h-3.5 shrink-0" />}
              {statusMsg.mode === "err" && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
              {statusMsg.text}
            </span>
          </div>
        </main>
      </div>

      <canvas ref={offscreenCanvasRef} className="hidden" />
    </div>
  );
}
