"use client";

import { type DragEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { CANVAS_SIZE } from "@/data/widgets";
import type { WidgetConfig } from "@/types/widgets";
import { CanvasContext } from "./CanvasContext";

type Point = { x: number; y: number };
type TouchCanvasProps = {
  children: ReactNode;
  screens: WidgetConfig[];
  singleScreen: ReactNode;
  displayMode: "single" | "grid";
  selectedScreenId: string;
  onDisplayModeChange: (mode: "single" | "grid") => void;
  onSelectScreen: (id: string) => void;
  onMoveScreen: (id: string, x: number, y: number) => void;
  onOpenSourceEditor: (id: string) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const MIN_SCALE = .28;
const MAX_SCALE = .95;
const ZOOM_STEP = .08;

export function TouchCanvas({ children, screens, singleScreen, displayMode, selectedScreenId, onDisplayModeChange, onSelectScreen, onMoveScreen, onOpenSourceEditor }: TouchCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef({ active: false, start: { x: 0, y: 0 }, origin: { x: 0, y: 0 }, last: { x: 0, y: 0 }, time: 0, velocity: { x: 0, y: 0 } });
  const frame = useRef<number | null>(null);
  const [scale, setScale] = useState(.56);
  const [position, setPosition] = useState<Point>({ x: -80, y: -60 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [draggedScreen, setDraggedScreen] = useState<string | null>(null);

  const bound = useCallback((point: Point, nextScale = scale) => {
    const element = ref.current;
    if (!element) return point;
    return { x: clamp(point.x, Math.min(0, element.clientWidth - CANVAS_SIZE.width * nextScale), 0), y: clamp(point.y, Math.min(0, element.clientHeight - CANVAS_SIZE.height * nextScale), 0) };
  }, [scale]);

  useEffect(() => {
    const resize = () => {
      const next = clamp(window.innerWidth / 3000, .34, .82);
      setScale(next);
      setPosition((current) => bound(current, next));
    };
    resize();
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, [bound]);

  useEffect(() => {
    const enterFullscreen = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => undefined);
    };
    enterFullscreen();
    window.addEventListener("pointerdown", enterFullscreen, { once: true, capture: true });
    return () => window.removeEventListener("pointerdown", enterFullscreen, true);
  }, []);

  const stop = () => { if (frame.current) cancelAnimationFrame(frame.current); };
  const momentum = useCallback((velocity: Point) => {
    let current = velocity;
    const tick = () => {
      current = { x: current.x * .92, y: current.y * .92 };
      if (Math.hypot(current.x, current.y) < .08) return;
      setPosition((currentPosition) => bound({ x: currentPosition.x + current.x * 16, y: currentPosition.y + current.y * 16 }));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [bound]);

  useEffect(() => () => stop(), []);

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (displayMode !== "grid" || (event.target as HTMLElement).closest("[data-widget-interactive]")) return;
    stop();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { active: true, start: { x: event.clientX, y: event.clientY }, origin: position, last: { x: event.clientX, y: event.clientY }, time: performance.now(), velocity: { x: 0, y: 0 } };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = dragging.current;
    if (!active) return;
    const now = performance.now();
    const elapsed = Math.max(now - active.time, 1);
    active.velocity = { x: (event.clientX - active.last.x) / elapsed, y: (event.clientY - active.last.y) / elapsed };
    active.last = { x: event.clientX, y: event.clientY };
    active.time = now;
    setPosition(bound({ x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y }));
  };
  const up = () => {
    const active = dragging.current;
    if (!active) return;
    active.active = false;
    momentum(active.velocity);
  };

  const focusScreen = (screen: WidgetConfig) => {
    const element = ref.current;
    if (!element) return;
    setPosition(bound({ x: element.clientWidth / 2 - (screen.x + screen.width / 2) * scale, y: element.clientHeight / 2 - (screen.y + screen.height / 2) * scale }));
  };
  const changeZoom = (direction: 1 | -1) => {
    const element = ref.current;
    if (!element) return;
    const nextScale = clamp(Math.round((scale + direction * ZOOM_STEP) * 100) / 100, MIN_SCALE, MAX_SCALE);
    if (nextScale === scale) return;
    // Keep the point at the center of the viewport stable while zooming.
    const center = { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    setPosition((current) => bound({
      x: center.x - (center.x - current.x) * (nextScale / scale),
      y: center.y - (center.y - current.y) * (nextScale / scale),
    }, nextScale));
    setScale(nextScale);
  };
  const dragStart = (event: DragEvent<HTMLButtonElement>, id: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-jlcg-screen", id);
    setDraggedScreen(id);
  };
  const dropScreen = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("application/x-jlcg-screen") || draggedScreen;
    const screen = screens.find((item) => item.id === id);
    const element = ref.current;
    if (!id || !screen || !element) return;
    const bounds = element.getBoundingClientRect();
    const x = clamp((event.clientX - bounds.left - position.x) / scale - screen.width / 2, 0, CANVAS_SIZE.width - screen.width);
    const y = clamp((event.clientY - bounds.top - position.y) / scale - screen.height / 2, 0, CANVAS_SIZE.height - screen.height);
    onMoveScreen(id, x, y);
    setDraggedScreen(null);
  };
  const replaceSingleScreen = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("application/x-jlcg-screen") || draggedScreen;
    if (!id || !screens.some((screen) => screen.id === id)) return;
    onSelectScreen(id);
    setDraggedScreen(null);
    setMenuOpen(false);
  };

  return <CanvasContext.Provider value={{ displayMode, scale, moveScreen: onMoveScreen }}><main ref={ref} className="command-viewport" onContextMenu={(event) => event.preventDefault()} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {displayMode === "grid" && <div className="command-canvas" onDragOver={(event) => event.preventDefault()} onDrop={dropScreen} style={{ width: CANVAS_SIZE.width, height: CANVAS_SIZE.height, transform: `translate3d(${position.x}px,${position.y}px,0) scale(${scale})` }}>{children}</div>}
    {displayMode === "single" && <div className="command-canvas single-canvas" onDragOver={(event) => event.preventDefault()} onDrop={replaceSingleScreen}>{singleScreen}</div>}
    {displayMode === "grid" && <><header className="command-topbar" data-widget-interactive><img className="command-logo" src="/assets/jlcg-logo.png" alt="JLCG" /></header><aside>Drag anywhere to navigate the wall</aside>
      <div className="zoom-controls" data-widget-interactive aria-label="Canvas zoom controls">
        <button onClick={() => changeZoom(-1)} disabled={scale <= MIN_SCALE} aria-label="Zoom out" title="Zoom out">−</button>
        <output aria-label={`Zoom level ${Math.round(scale * 100)} percent`}>{Math.round(scale * 100)}%</output>
        <button onClick={() => changeZoom(1)} disabled={scale >= MAX_SCALE} aria-label="Zoom in" title="Zoom in">+</button>
      </div>
    </>}
    <nav className={`screen-sidebar ${displayMode === "single" ? "single-mode" : ""} ${menuOpen ? "is-open" : ""}`} data-widget-interactive aria-label="Screen menu">
      <button className="screen-grid-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="screen-list" title="Open screen grid"><i /><i /><i /><span className="menu-label">Menu</span></button>
      <section id="screen-list" className="screen-panel" aria-hidden={!menuOpen}>
        <header><div><small>SCREEN CONTROL</small><strong>{displayMode === "grid" ? "Grid view" : "Full-screen view"}</strong></div><button onClick={() => setMenuOpen(false)} aria-label="Close screen menu">×</button></header>
        <button className="view-mode-button" onClick={() => onDisplayModeChange(displayMode === "grid" ? "single" : "grid")}>{displayMode === "grid" ? "▣ Exit Grid View" : "▦ Open Grid View"}</button>
        <button className="source-menu-button" onClick={() => onOpenSourceEditor(displayMode === "single" ? selectedScreenId : screens[0].id)}>Set widget source</button>
        <p>{displayMode === "grid" ? "All 8 screens are aligned. Drag a screen to reposition it." : "Tap a screen, or drag it onto the viewer, to replace only the current screen."}</p>
        <div className="screen-list">{screens.map((screen, index) => <button key={screen.id} className={`screen-item ${draggedScreen === screen.id ? "is-dragging" : ""} ${displayMode === "single" && selectedScreenId === screen.id ? "is-selected" : ""}`} draggable onDragStart={(event) => dragStart(event, screen.id)} onDragEnd={() => setDraggedScreen(null)} onClick={() => displayMode === "grid" ? focusScreen(screen) : onSelectScreen(screen.id)}><b>{String(index + 1).padStart(2, "0")}</b><span className={`screen-dot ${screen.accent}`} /><span><strong>{screen.title}</strong><small>{screen.source?.label ?? "Operations service"}</small></span><em aria-hidden="true">{displayMode === "grid" ? "⠿" : "✓"}</em></button>)}</div>
      </section>
    </nav>
  </main></CanvasContext.Provider>;
}
