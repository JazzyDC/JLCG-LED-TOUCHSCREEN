"use client";

import { memo, type PointerEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CANVAS_SIZE } from "@/data/widgets";
import { useCanvasControls } from "@/components/canvas/CanvasContext";
import { MobileDeviceWidget } from "@/components/widgets/MobileDeviceWidget";
import type { WidgetConfig } from "@/types/widgets";

const metric = [["Attendance", "94.8%", "+2.4%"], ["Visitors", "1,284", "+18.2%"], ["Open tasks", "37", "-12 today"], ["Announcements", "06", "2 unread"]];
const withProtocol = (value: string) => /^https?:\/\//i.test(value) || /^(file|blob):/i.test(value) ? value : `https://${value}`;
const getYoutubeId = (url: URL) => {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0];
  if (!host.endsWith("youtube.com") && host !== "youtube-nocookie.com") return "";
  if (url.pathname === "/watch") return url.searchParams.get("v") ?? "";
  const [, section, id] = url.pathname.split("/");
  return ["embed", "shorts", "live"].includes(section) ? id : "";
};
const canvaEmbedUrl = (url: URL) => {
  const parts = url.pathname.split("/").filter(Boolean);
  const designId = parts[1];
  return designId ? `https://www.canva.com/design/${designId}/view?embed&meta` : "";
};
const embedUrl = (raw = "") => {
  try {
    const url = new URL(withProtocol(raw.trim()));
    const youtubeId = getYoutubeId(url);
    if (youtubeId) {
      const embed = new URL(`https://www.youtube-nocookie.com/embed/${youtubeId}`);
      embed.searchParams.set("autoplay", "1");
      embed.searchParams.set("mute", "1");
      embed.searchParams.set("playsinline", "1");
      embed.searchParams.set("rel", "0");
      embed.searchParams.set("controls", "0");
      embed.searchParams.set("disablekb", "1");
      embed.searchParams.set("iv_load_policy", "3");
      embed.searchParams.set("modestbranding", "1");
      embed.searchParams.set("loop", "1");
      embed.searchParams.set("playlist", youtubeId);
      const start = url.searchParams.get("start") ?? url.searchParams.get("t");
      if (start) embed.searchParams.set("start", start.replace(/\D+$/g, ""));
      return embed.toString();
    }
    if (url.hostname.replace(/^www\./, "") === "canva.com" && url.pathname.startsWith("/design/")) {
      const embed = canvaEmbedUrl(url);
      if (embed) return embed;
    }
  } catch {
    return raw;
  }
  return raw;
};
const isYoutubeUrl = (raw = "") => {
  try {
    return !!getYoutubeId(new URL(withProtocol(raw.trim())));
  } catch {
    return false;
  }
};
const isVideoUrl = (raw = "", contentType = "") => contentType.startsWith("video/") || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(raw);
const isPdfUrl = (raw = "", contentType = "") => contentType === "application/pdf" || /\.pdf(?:$|[?#])/i.test(raw);

type PdfPage = {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
};
type PdfDocument = { numPages: number; getPage(pageNumber: number): Promise<PdfPage> };
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: { url: string }): { promise: Promise<PdfDocument> };
};

function PdfDeck({ w }: { w: WidgetConfig }) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(Math.max(1, w.source?.pages ?? 16));
  const [images, setImages] = useState<Record<number, string>>({});
  const [direction, setDirection] = useState<1 | -1>(1);
  const [animating, setAnimating] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pdfjs = useRef<PdfJs | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const cache = useRef<Map<number, string>>(new Map());
  const sourceUrl = w.source?.url ?? "";

  useEffect(() => {
    let cancelled = false;
    documentRef.current = null;
    cache.current.clear();
    setImages({});
    setPage(1);
    setPages(Math.max(1, w.source?.pages ?? 16));

    void import("pdfjs-dist").then(async (pdf) => {
      if (cancelled) return;
      pdf.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      pdfjs.current = pdf as PdfJs;
      const document = await pdf.getDocument({ url: sourceUrl }).promise as PdfDocument;
      if (cancelled) return;
      documentRef.current = document;
      setPages(document.numPages);
      await Promise.all([1, 2].map((pageNumber) => renderPage(pageNumber)));
    }).catch(() => undefined);

    return () => { cancelled = true; };
  }, [sourceUrl]);

  const renderPage = async (pageNumber: number) => {
    if (cache.current.has(pageNumber) || pageNumber < 1) return;
    const pdfDocument = documentRef.current;
    if (!pdfDocument || pageNumber > pdfDocument.numPages) return;
    const pdfPage = await pdfDocument.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: 1.8 });
    const canvas = window.document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    const image = canvas.toDataURL("image/jpeg", .92);
    cache.current.set(pageNumber, image);
    setImages((current) => ({ ...current, [pageNumber]: image }));
  };

  const goToPage = async (nextPage: number, nextDirection: 1 | -1) => {
    if (animating || nextPage === page || nextPage < 1 || nextPage > pages) return;
    await renderPage(nextPage);
    setDirection(nextDirection);
    setPage(nextPage);
    setAnimating(true);
    window.setTimeout(() => setAnimating(false), 320);
    void renderPage(nextPage + 1);
    void renderPage(nextPage - 1);
  };

  const finishSwipe = (event: PointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    start.current = null;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    void goToPage(dx < 0 ? page + 1 : page - 1, dx < 0 ? 1 : -1);
  };

  return <div className="pdf-deck">
    {images[page] ? <img key={page} className={`pdf-page-image ${animating ? direction === 1 ? "slide-from-right" : "slide-from-left" : ""}`} src={images[page]} alt={`${w.title} page ${page}`} /> : <div className="pdf-rendering"><i />Loading page</div>}
    <div className="pdf-swipe-layer" onPointerDown={(event) => { start.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={finishSwipe} onPointerCancel={() => { start.current = null; }} />
    <output className="pdf-page-indicator">{page} / {pages}</output>
  </div>;
}

function LiveCamera({ w }: { w: WidgetConfig }) {
  const [version, setVersion] = useState(() => Math.floor(Date.now() / 300000));
  useEffect(() => {
    const timer = window.setInterval(() => setVersion(Math.floor(Date.now() / 300000)), 300000);
    return () => window.clearInterval(timer);
  }, []);
  const source = w.source!;
  const separator = source.imageUrl!.includes("?") ? "&" : "?";
  return <a href={source.url} target="_blank" rel="noreferrer" title={`Open ${w.title} on SkylineWebcams`} style={{ position: "relative", display: "block", width: "100%", height: "100%", overflow: "hidden", background: "#05080d" }}><img src={`${source.imageUrl}${separator}v=${version}`} alt={`LIVE ${w.title} | SkylineWebcams`} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} /></a>;
}

function Content({ w, mobileFullscreen = false, onExitFullscreen }: { w: WidgetConfig; mobileFullscreen?: boolean; onExitFullscreen?: () => void }) {
  const [bad, setBad] = useState(false);
  const sourceUrl = w.source?.url ?? "";
  if (w.type === "presentation" && (w.source?.contentType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(w.source?.url ?? ""))) return <img className="frame image-frame" src={w.source?.url} alt={w.title} />;
  if (w.type === "presentation" && sourceUrl && isPdfUrl(sourceUrl, w.source?.contentType)) return <PdfDeck w={w} />;
  if (w.type === "cctv" && sourceUrl && isYoutubeUrl(sourceUrl)) return <iframe className="frame" src={embedUrl(sourceUrl)} title={w.title} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />;
  if (w.type === "cctv" && sourceUrl && isVideoUrl(sourceUrl, w.source?.contentType) && !bad) return <video className="frame" controls autoPlay loop muted playsInline onError={() => setBad(true)}><source src={sourceUrl} /></video>;
  if (w.type === "cctv" && w.source?.imageUrl) return <LiveCamera w={w} />;
  if (w.type === "cctv" && sourceUrl) return <iframe className="frame" src={embedUrl(sourceUrl)} title={w.title} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />;
  if (w.type === "cctv") return <div className="camera"><i /><div><b className="live">LIVE</b><strong>{w.source?.label}</strong><small>Secure feed - 1080p</small></div><time>14:32:08</time></div>;
  if (w.type === "presentation" && w.source?.url) return <iframe className="frame" src={embedUrl(w.source.url)} title={w.title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />;
  if (w.type === "presentation") return <div className="presentation"><em>02 <small>/ 02</small></em><p>EXTERNAL PRESENTATION</p><h3>{w.title}</h3><span>Add an approved third-party embed URL to display it here.</span><footer><i /><i /><i /></footer></div>;
  if (w.type === "mobile") return <MobileDeviceWidget sessionKey={w.id} fullscreen={mobileFullscreen} onExitFullscreen={onExitFullscreen} />;
  if (w.type === "dashboard") return <div className="dash"><div className="metrics">{metric.map(([a, b, c]) => <article key={a}><span>{a}</span><b>{b}</b><small>{c}</small></article>)}</div><div className="chart"><span>Activity trend</span><div>{[38, 56, 47, 71, 61, 88, 78].map((n, i) => <i key={i} style={{ height: `${n}%` }} />)}</div></div></div>;
  if (w.type === "youtube") return <iframe className="frame" src={embedUrl(w.source?.url)} title={w.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />;
  if (w.type === "video" && !bad) return <video className="frame" controls autoPlay loop muted playsInline onError={() => setBad(true)}><source src={w.source?.url} type="video/mp4" /></video>;
  return <div className="unavailable"><b>PLAY</b><strong>Internal video ready</strong><small>Add your MP4 file to public/videos.</small></div>;
}

function CameraFullscreenGrid({ w }: { w: WidgetConfig }) {
  const feeds = [w.source?.url, w.source?.secondaryUrl].filter((url): url is string => !!url);
  const cameraNumber = w.id === "camera-lobby" ? "2" : "1";
  return <div className="camera-fullscreen-grid">{feeds.map((url, index) => <section key={url}>
    <span>{`Camera ${cameraNumber}${index === 0 ? "A" : "B"}`}</span>
    <iframe src={embedUrl(url)} title={`${w.title} feed ${index + 1}`} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" tabIndex={-1} aria-hidden="true" />
  </section>)}</div>;
}

export const Widget = memo(function Widget({ widget: w }: { widget: WidgetConfig }) {
  const [full, setFull] = useState(false);
  const [positioning, setPositioning] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const { displayMode, scale, moveScreen } = useCanvasControls();
  useEffect(() => {
    document.body.classList.toggle("widget-fullscreen-active", full);
    return () => document.body.classList.remove("widget-fullscreen-active");
  }, [full]);
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (displayMode !== "grid" || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, left: w.x, top: w.y };
    setPositioning(true);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    const left = Math.min(Math.max(0, active.left + (event.clientX - active.x) / scale), CANVAS_SIZE.width - w.width);
    const top = Math.min(Math.max(0, active.top + (event.clientY - active.y) / scale), CANVAS_SIZE.height - w.height);
    moveScreen(w.id, left, top);
  };
  const stopDrag = () => { drag.current = null; setPositioning(false); };
  const head = <div className="widget-header" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}><div><b className="icon">{w.icon}</b><section><h2>{w.title}</h2><p>{w.source?.label ?? "Operations service"}</p></section></div></div>;
  // Keep the same mobile component mounted when entering full-screen. Creating
  // a second instance forces a fresh decoder to wait for the next H.264 keyframe.
  const body = w.source?.secondaryUrl ? <CameraFullscreenGrid w={w} /> : <Content w={w} mobileFullscreen={w.type === "mobile" && full} onExitFullscreen={() => setFull(false)} />;
  const fullscreenBody = w.source?.secondaryUrl ? <CameraFullscreenGrid w={w} /> : <Content w={w} />;
  const overlay = full && w.type !== "mobile" && typeof document !== "undefined" ? createPortal(<div className="overlay widget-fullscreen-overlay" data-widget-interactive><button className="fullscreen-close" onClick={() => setFull(false)} aria-label="Close full-screen view">x</button><div className={`fullscreen-content ${w.accent}`}>{fullscreenBody}</div></div>, document.body) : null;
  return <><article className={`widget ${w.accent} ${positioning ? "is-positioning" : ""} ${w.type === "mobile" && full ? "mobile-widget-fullscreen" : ""}`} style={{ left: w.x, top: w.y, width: w.width, height: w.height }} data-widget-interactive>{head}{body}{displayMode === "grid" && !full && <div className="widget-center-fullscreen" role="button" tabIndex={0} aria-label={`Open ${w.title} full-screen`} onClick={() => setFull(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFull(true); } }} />}</article>{overlay}</>;
});
