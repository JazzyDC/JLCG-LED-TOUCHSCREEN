"use client";

import { type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const MIN_SCALE = .14;
// Keep the authored 4500x2810 layout intact while allowing it to remain crisp
// and fill high-resolution LED walls. The previous .95 cap left large displays
// with unnecessary empty space.
const MAX_SCALE = 6;
const ZOOM_STEP = .08;

export function TouchCanvas({ children, screens, singleScreen, displayMode, selectedScreenId, onDisplayModeChange, onSelectScreen, onMoveScreen, onOpenSourceEditor }: TouchCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(.56);
  const [position, setPosition] = useState<Point>({ x: -80, y: -60 });
  const [minScale, setMinScale] = useState(MIN_SCALE);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draggedScreen, setDraggedScreen] = useState<string | null>(null);

  const computeFitScale = useCallback(() => {
    const element = ref.current;
    if (!element) return MIN_SCALE;
    // .92 leaves a little breathing room around the edges instead of an exact edge-to-edge fit.
    return Math.min(element.clientWidth / CANVAS_SIZE.width, element.clientHeight / CANVAS_SIZE.height) * .92;
  }, []);

  // Active pointers on the canvas, keyed by pointerId (supports multi-touch).
  const pointers = useRef<Map<number, Point>>(new Map());

  // Single-finger pan state.
  const dragging = useRef({ active: false, start: { x: 0, y: 0 }, origin: { x: 0, y: 0 }, last: { x: 0, y: 0 }, time: 0, velocity: { x: 0, y: 0 } });

  // Two-finger pinch-zoom state.
  const pinch = useRef({ active: false, startDistance: 0, startScale: 1, rectLeft: 0, rectTop: 0, contentPoint: { x: 0, y: 0 } });

  // Pending position/scale updates get flushed once per animation frame instead
  // of once per pointer event â€” this keeps drag/pinch movement smooth even when
  // the browser reports many pointermove events per frame on touch devices.
  const pending = useRef<{ position?: Point; scale?: number }>({});
  const rafId = useRef<number | null>(null);
  const momentumFrame = useRef<number | null>(null);

  const flush = () => {
    rafId.current = null;
    if (pending.current.position) setPosition(pending.current.position);
    if (pending.current.scale !== undefined) setScale(pending.current.scale);
  };
  const schedule = (next: { position?: Point; scale?: number }) => {
    pending.current = { ...pending.current, ...next };
    if (rafId.current == null) rafId.current = requestAnimationFrame(flush);
  };
  const currentPosition = () => pending.current.position ?? position;
  const currentScale = () => pending.current.scale ?? scale;

  // Kept in sync with state, but updated synchronously so rapid/repeated zoom-button
  // presses (e.g. press-and-hold) always read the just-computed value instead of a
  // stale one from before the component re-rendered.
  const scaleRef = useRef(scale);
  const positionRef = useRef(position);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { positionRef.current = position; }, [position]);

  // Smooth animated transition + press-and-hold repeat for the +/- zoom buttons.
  const [smoothZoom, setSmoothZoom] = useState(false);
  const smoothZoomTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const bound = useCallback((point: Point, nextScale = scaleRef.current) => {
    const element = ref.current;
    if (!element) return point;
    const contentWidth = CANVAS_SIZE.width * nextScale;
    const contentHeight = CANVAS_SIZE.height * nextScale;
    return {
      x: contentWidth <= element.clientWidth ? (element.clientWidth - contentWidth) / 2 : clamp(point.x, element.clientWidth - contentWidth, 0),
      y: contentHeight <= element.clientHeight ? (element.clientHeight - contentHeight) / 2 : clamp(point.y, element.clientHeight - contentHeight, 0),
    };
  }, []);

  useEffect(() => {
    const resize = () => {
      const fit = computeFitScale();
      const next = clamp(fit, MIN_SCALE, MAX_SCALE);
      setScale(next);
      setPosition(bound({ x: 0, y: 0 }, next));
      setMinScale(Math.min(MIN_SCALE, fit * .85));
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (ref.current) observer.observe(ref.current);
    addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      removeEventListener("resize", resize);
    };
  }, [bound, computeFitScale]);

  useEffect(() => {
    const enterFullscreen = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => undefined);
    };
    enterFullscreen();
    window.addEventListener("pointerdown", enterFullscreen, { once: true, capture: true });
    return () => window.removeEventListener("pointerdown", enterFullscreen, true);
  }, []);

  const stopMomentum = () => { if (momentumFrame.current) cancelAnimationFrame(momentumFrame.current); };
  const momentum = useCallback((velocity: Point) => {
    let current = velocity;
    const tick = () => {
      current = { x: current.x * .92, y: current.y * .92 };
      if (Math.hypot(current.x, current.y) < .08) return;
      setPosition((currentPosition) => bound({ x: currentPosition.x + current.x * 16, y: currentPosition.y + current.y * 16 }));
      momentumFrame.current = requestAnimationFrame(tick);
    };
    momentumFrame.current = requestAnimationFrame(tick);
  }, [bound]);

  useEffect(() => () => {
    stopMomentum();
    if (rafId.current) cancelAnimationFrame(rafId.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    if (smoothZoomTimeout.current) clearTimeout(smoothZoomTimeout.current);
  }, []);

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (displayMode !== "grid") return;
    const interactive = !!(event.target as HTMLElement).closest("[data-widget-interactive]");
    // Always record this touch point, even if it landed on a widget or a button â€”
    // otherwise a genuine 2-finger pinch that happens to have one finger over a
    // widget never gets detected as 2 fingers, and degrades into a 1-finger pan.
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      // Second finger just landed anywhere on the canvas: pinch-zoom always wins,
      // even if one/both fingers started over a widget or a UI button.
      stopZoomHold();
      setSmoothZoom(false);
      stopMomentum();
      dragging.current.active = false;
      pointers.current.forEach((_, id) => { try { event.currentTarget.setPointerCapture(id); } catch { /* no-op */ } });
      const [p1, p2] = Array.from(pointers.current.values());
      const rect = ref.current?.getBoundingClientRect();
      const startMid = midpoint(p1, p2);
      const startScale = currentScale();
      const startPosition = currentPosition();
      pinch.current = {
        active: true,
        startDistance: distance(p1, p2),
        startScale,
        rectLeft: rect?.left ?? 0,
        rectTop: rect?.top ?? 0,
        contentPoint: {
          x: (startMid.x - (rect?.left ?? 0) - startPosition.x) / startScale,
          y: (startMid.y - (rect?.top ?? 0) - startPosition.y) / startScale,
        },
      };
      return;
    }

    if (pointers.current.size === 1) {
      if (interactive) return; // let the widget-header / button handle its own single-finger behavior
      stopZoomHold();
      setSmoothZoom(false);
      stopMomentum();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = { active: true, start: { x: event.clientX, y: event.clientY }, origin: currentPosition(), last: { x: event.clientX, y: event.clientY }, time: performance.now(), velocity: { x: 0, y: 0 } };
    }
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch.current.active && pointers.current.size >= 2) {
      const [p1, p2] = Array.from(pointers.current.values());
      const currentDistance = distance(p1, p2);
      const currentMid = midpoint(p1, p2);
      const ratio = currentDistance / (pinch.current.startDistance || 1);
      const nextScale = clamp(pinch.current.startScale * ratio, minScale, MAX_SCALE);
      const nextPosition = bound({
        x: (currentMid.x - pinch.current.rectLeft) - pinch.current.contentPoint.x * nextScale,
        y: (currentMid.y - pinch.current.rectTop) - pinch.current.contentPoint.y * nextScale,
      }, nextScale);
      schedule({ position: nextPosition, scale: nextScale });
      return;
    }

    const active = dragging.current;
    if (!active.active) return;
    const now = performance.now();
    const elapsed = Math.max(now - active.time, 1);
    active.velocity = { x: (event.clientX - active.last.x) / elapsed, y: (event.clientY - active.last.y) / elapsed };
    active.last = { x: event.clientX, y: event.clientY };
    active.time = now;
    schedule({ position: bound({ x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y }) });
  };

  const up = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);

    if (pinch.current.active) {
      if (pointers.current.size < 2) {
        pinch.current.active = false;
        const remaining = Array.from(pointers.current.values())[0];
        if (remaining) {
          // One finger still down: resume panning from exactly where the pinch left off, no jump.
          dragging.current = { active: true, start: remaining, origin: currentPosition(), last: remaining, time: performance.now(), velocity: { x: 0, y: 0 } };
        }
      }
      return;
    }

    const active = dragging.current;
    if (!active.active) return;
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
    const scaleNow = scaleRef.current;
    const positionNow = positionRef.current;
    const nextScale = clamp(Math.round((scaleNow + direction * ZOOM_STEP) * 100) / 100, minScale, MAX_SCALE);
    if (nextScale === scaleNow) return;
    // Keep the point at the center of the viewport stable while zooming.
    const center = { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    const nextPosition = bound({
      x: center.x - (center.x - positionNow.x) * (nextScale / scaleNow),
      y: center.y - (center.y - positionNow.y) * (nextScale / scaleNow),
    }, nextScale);
    // Update refs immediately so a fast follow-up call (hold-to-repeat) reads the
    // fresh value right away instead of waiting for React to re-render first.
    scaleRef.current = nextScale;
    positionRef.current = nextPosition;
    setScale(nextScale);
    setPosition(nextPosition);
  };

  const animateZoomStep = (direction: 1 | -1) => {
    changeZoom(direction);
    setSmoothZoom(true);
    if (smoothZoomTimeout.current) clearTimeout(smoothZoomTimeout.current);
    smoothZoomTimeout.current = setTimeout(() => setSmoothZoom(false), 260);
  };
  const stopZoomHold = () => {
    if (holdInterval.current) { clearInterval(holdInterval.current); holdInterval.current = null; }
  };
  const startZoomHold = (direction: 1 | -1) => {
    stopZoomHold();
    animateZoomStep(direction);
    holdInterval.current = setInterval(() => animateZoomStep(direction), 200);
  };
  const zoomButtonDown = (event: PointerEvent<HTMLButtonElement>, direction: 1 | -1) => {
    event.preventDefault();
    event.stopPropagation();
    startZoomHold(direction);
  };
  const zoomButtonClick = (event: MouseEvent<HTMLButtonElement>, direction: 1 | -1) => {
    event.preventDefault();
    event.stopPropagation();
    if (!holdInterval.current) animateZoomStep(direction);
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

  const viewportWidth = ref.current?.clientWidth ?? CANVAS_SIZE.width * scale;
  const viewportHeight = ref.current?.clientHeight ?? CANVAS_SIZE.height * scale;
  const viewportMin = Math.min(viewportWidth, viewportHeight);
  const fullscreenGutter = clamp(viewportMin * .015, 12, 28);
  const fullscreenLeftRail = clamp(viewportWidth * .1, 82, 193);

  return <CanvasContext.Provider value={{ displayMode, scale, moveScreen: onMoveScreen }}><main ref={ref} className="command-viewport" onContextMenu={(event) => event.preventDefault()} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {displayMode === "grid" && <div className="demo-branding" aria-label="QC DRRMO and JLCG">
      <div className="demo-brand-logo-group">
        <img className="demo-brand-logo demo-brand-logo-qcdrrmo" src="/assets/qcdrrmo-palaro-logo.png" alt="QC DRRMO" />
        <img className="demo-brand-logo" src="/assets/jlcg-logo.png" alt="JLCG" />
      </div>
      <p>JLCG Touchscreen LED Demo for QC DRRMO</p>
    </div>}
    {displayMode === "grid" && <div className="command-canvas" onDragOver={(event) => event.preventDefault()} onDrop={dropScreen} style={{
      width: CANVAS_SIZE.width,
      height: CANVAS_SIZE.height,
      transform: `translate3d(${position.x}px,${position.y}px,0) scale(${scale})`,
      transition: smoothZoom ? "transform .26s cubic-bezier(.4,0,.2,1)" : "none",
      "--mobile-fullscreen-left": `${(fullscreenLeftRail - position.x) / scale}px`,
      "--mobile-fullscreen-top": `${(fullscreenGutter - position.y) / scale}px`,
      "--mobile-fullscreen-width": `${(viewportWidth - fullscreenLeftRail - fullscreenGutter) / scale}px`,
      "--mobile-fullscreen-height": `${(viewportHeight - fullscreenGutter * 2) / scale}px`,
      "--mobile-fullscreen-control": `${40 / scale}px`,
      "--mobile-fullscreen-control-offset": `${12 / scale}px`,
      "--mobile-fullscreen-border": `${1 / scale}px`,
      "--mobile-canvas-scale": scale,
      "--mobile-inverse-scale": 1 / scale,
    } as CSSProperties}>{children}</div>}
    {displayMode === "single" && <div className="command-canvas single-canvas" onDragOver={(event) => event.preventDefault()} onDrop={replaceSingleScreen}>{singleScreen}</div>}
    {displayMode === "grid" && <><aside>Drag anywhere to navigate the wall - pinch with two fingers to zoom</aside></>}
    <nav className={`screen-sidebar ${displayMode === "single" ? "single-mode" : ""} ${menuOpen ? "is-open" : ""}`} data-widget-interactive aria-label="Screen menu">
      <button className="screen-grid-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="screen-list" title="Open screen grid"><i /><i /><i /><span className="menu-label">Menu</span></button>
      <section id="screen-list" className="screen-panel" aria-hidden={!menuOpen}>
        <header><div><small>SCREEN CONTROL</small><strong>{displayMode === "grid" ? "Grid view" : "Full-screen view"}</strong></div><button onClick={() => setMenuOpen(false)} aria-label="Close screen menu">x</button></header>
        <button className="view-mode-button" onClick={() => onDisplayModeChange(displayMode === "grid" ? "single" : "grid")}>{displayMode === "grid" ? "Exit Grid View" : "Open Grid View"}</button>
        <button className="source-menu-button" onClick={() => onOpenSourceEditor(displayMode === "single" ? selectedScreenId : screens[0].id)}>Set widget source</button>
        <p>{displayMode === "grid" ? `All ${screens.length} screens are aligned. Drag a screen to reposition it.` : "Tap a screen, or drag it onto the viewer, to replace only the current screen."}</p>
        <div className="screen-list">{screens.map((screen, index) => <button key={screen.id} className={`screen-item ${draggedScreen === screen.id ? "is-dragging" : ""} ${displayMode === "single" && selectedScreenId === screen.id ? "is-selected" : ""}`} draggable onDragStart={(event) => dragStart(event, screen.id)} onDragEnd={() => setDraggedScreen(null)} onClick={() => displayMode === "grid" ? focusScreen(screen) : onSelectScreen(screen.id)}><b>{String(index + 1).padStart(2, "0")}</b><span className={`screen-dot ${screen.accent}`} /><span><strong>{screen.title}</strong><small>{screen.source?.label ?? "Operations service"}</small></span>{displayMode === "grid" && <em aria-hidden="true">::</em>}</button>)}</div>
      </section>
    </nav>
  </main></CanvasContext.Provider>;
}
