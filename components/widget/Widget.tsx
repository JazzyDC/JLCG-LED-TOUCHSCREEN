"use client";

import { memo, type PointerEvent, useEffect, useRef, useState } from "react";
import { CANVAS_SIZE } from "@/data/widgets";
import { useCanvasControls } from "@/components/canvas/CanvasContext";
import { MobileDeviceWidget } from "@/components/widgets/MobileDeviceWidget";
import type { WidgetConfig } from "@/types/widgets";

const metric = [["Attendance", "94.8%", "+2.4%"], ["Visitors", "1,284", "+18.2%"], ["Open tasks", "37", "-12 today"], ["Announcements", "06", "2 unread"]];

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
  if (w.type === "presentation" && (w.source?.contentType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(w.source?.url ?? ""))) return <img className="frame image-frame" src={w.source?.url} alt={w.title} />;
  if (w.type === "cctv" && w.source?.imageUrl) return <LiveCamera w={w} />;
  if (w.type === "cctv") return <div className="camera"><i /><div><b className="live">LIVE</b><strong>{w.source?.label}</strong><small>Secure feed · 1080p</small></div><time>14:32:08</time></div>;
  if (w.type === "presentation" && w.source?.url) return <iframe className="frame" src={w.source.url} title={w.title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />;
  if (w.type === "presentation") return <div className="presentation"><em>02 <small>/ 02</small></em><p>EXTERNAL PRESENTATION</p><h3>{w.title}</h3><span>Add an approved third-party embed URL to display it here.</span><footer><i /><i /><i /></footer></div>;
  if (w.type === "mobile") return <MobileDeviceWidget fullscreen={mobileFullscreen} onExitFullscreen={onExitFullscreen} />;
  if (w.type === "dashboard") return <div className="dash"><div className="metrics">{metric.map(([a, b, c]) => <article key={a}><span>{a}</span><b>{b}</b><small>{c}</small></article>)}</div><div className="chart"><span>Activity trend</span><div>{[38, 56, 47, 71, 61, 88, 78].map((n, i) => <i key={i} style={{ height: `${n}%` }} />)}</div></div></div>;
  if (w.type === "youtube") return <iframe className="frame" src={w.source?.url} title={w.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />;
  if (w.type === "video" && !bad) return <video className="frame" controls loop muted playsInline onError={() => setBad(true)}><source src={w.source?.url} type="video/mp4" /></video>;
  return <div className="unavailable"><b>▶</b><strong>Internal video ready</strong><small>Add your MP4 file to public/videos.</small></div>;
}

export const Widget = memo(function Widget({ widget: w }: { widget: WidgetConfig }) {
  const [full, setFull] = useState(false);
  const [loading, setLoading] = useState(false);
  const [positioning, setPositioning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const { displayMode, scale, moveScreen } = useCanvasControls();
  const refresh = () => { setLoading(true); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setLoading(false), 550); };
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
  const head = <div className="widget-header" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}><div><b className="icon">{w.icon}</b><section><h2>{w.title}</h2><p>{w.source?.label ?? "Operations service"}</p></section></div><nav><button onClick={refresh}>↻</button><button onClick={() => setFull(!full)}>{full ? "×" : "⛶"}</button></nav></div>;
  const body = loading ? <div className="loading"><i />Refreshing feed…</div> : <Content w={w} />;
  const fullscreenBody = loading ? <div className="loading"><i />Refreshing feed…</div> : <Content w={w} mobileFullscreen={w.type === "mobile"} onExitFullscreen={() => setFull(false)} />;
  return <><article className={`widget ${w.accent} ${positioning ? "is-positioning" : ""}`} style={{ left: w.x, top: w.y, width: w.width, height: w.height }} data-widget-interactive>{head}{body}</article>{full && <div className={`overlay ${w.type === "mobile" ? "mobile-overlay" : ""}`} data-widget-interactive><article className={`widget fullscreen ${w.accent} ${w.type === "mobile" ? "mobile-fullscreen" : ""}`}>{head}{fullscreenBody}</article></div>}</>;
});
