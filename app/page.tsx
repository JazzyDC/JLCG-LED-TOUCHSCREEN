"use client";

import { type ChangeEvent, useState } from "react";
import { TouchCanvas } from "@/components/canvas/TouchCanvas";
import { Widget } from "@/components/widget/Widget";
import { widgets } from "@/data/widgets";
import type { WidgetConfig } from "@/types/widgets";

const LEGACY_SOURCES = new Set([
  "/pdf/JLCG%20Profile%20Deck%20032026.pdf",
  "https://www.canva.com/design/DAG70_Tex-U/mwourEJAaO_Snsnb1Z3V-A/view?embed",
]);

export default function Home() {
  const [screens, setScreens] = useState<WidgetConfig[]>(() => {
    if (typeof window === "undefined") return widgets;
    const saved = window.localStorage.getItem("jlcg-widget-sources");
    if (!saved) return widgets;
    try {
      const stored = JSON.parse(saved) as WidgetConfig[];
      const cleaned = stored.map((screen) => LEGACY_SOURCES.has(screen.source?.url ?? "") ? { ...screen, source: { label: "Presentation source not set" } } : screen);
      if (cleaned.some((screen, index) => screen !== stored[index])) window.localStorage.setItem("jlcg-widget-sources", JSON.stringify(cleaned));
      return cleaned;
    } catch { window.localStorage.removeItem("jlcg-widget-sources"); return widgets; }
  });
  const [displayMode, setDisplayMode] = useState<"single" | "grid">("single");
  const [selectedScreenId, setSelectedScreenId] = useState(widgets[0].id);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [sourceScreenId, setSourceScreenId] = useState(widgets[0].id);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceContentType, setSourceContentType] = useState("");

  const resourceType = (url: string, contentType = ""): WidgetConfig["type"] => contentType.startsWith("video/") || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(url) ? "video" : "presentation";
  const saveSource = (url: string) => {
    const value = url.trim();
    if (!value) return;
    setScreens((current) => {
      const next = current.map((screen) => screen.id === sourceScreenId ? {
        ...screen,
        type: resourceType(value, sourceContentType),
        source: { ...screen.source, url: value, contentType: sourceContentType || undefined, label: value.split(/[\\/]/).pop() || "Custom source" },
      } : screen);
      window.localStorage.setItem("jlcg-widget-sources", JSON.stringify(next));
      return next;
    });
    setSelectedScreenId(sourceScreenId);
    setDisplayMode("single");
    setSourceEditorOpen(false);
  };
  const chooseBrowserFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) { setSourceUrl(URL.createObjectURL(file)); setSourceContentType(file.type); }
  };

  const moveScreen = (id: string, x: number, y: number) => {
    setScreens((current) => current.map((screen) => screen.id === id ? { ...screen, x, y } : screen));
  };

  const selectedScreen = screens.find((screen) => screen.id === selectedScreenId) ?? screens[0];
  const changeDisplayMode = (mode: "single" | "grid") => {
    if (mode === "grid") {
      setScreens((current) => current.map((screen, index) => ({
        ...screen,
        x: 140 + (index % 4) * 1090,
        y: 150 + Math.floor(index / 4) * 1030,
        width: 970,
        height: 900,
      })));
    }
    setDisplayMode(mode);
  };

  return <><TouchCanvas
    screens={screens}
    displayMode={displayMode}
    selectedScreenId={selectedScreenId}
    onDisplayModeChange={changeDisplayMode}
    onSelectScreen={setSelectedScreenId}
    onMoveScreen={moveScreen}
    onOpenSourceEditor={(id) => { const screen = screens.find((item) => item.id === id) ?? screens[0]; setSourceScreenId(screen.id); setSourceUrl(screen.source?.url ?? ""); setSourceContentType(screen.source?.contentType ?? ""); setSourceEditorOpen(true); }}
    singleScreen={<Widget widget={selectedScreen} />}
  >
    {screens.map((widget: WidgetConfig) => <Widget key={widget.id} widget={widget} />)}
  </TouchCanvas>
  {sourceEditorOpen && <div className="source-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="source-editor-title">
    <form className="source-editor" onSubmit={(event) => { event.preventDefault(); saveSource(sourceUrl); }}>
      <header><div><small>WIDGET SOURCE</small><h2 id="source-editor-title">Set a link or local file</h2></div><button type="button" onClick={() => setSourceEditorOpen(false)} aria-label="Close source editor">×</button></header>
      <label>Widget<select value={sourceScreenId} onChange={(event) => { const id = event.target.value; setSourceScreenId(id); setSourceUrl(screens.find((screen) => screen.id === id)?.source?.url ?? ""); }}>{screens.map((screen, index) => <option key={screen.id} value={screen.id}>{String(index + 1).padStart(2, "0")} — {screen.title}</option>)}</select></label>
      <label>Web link or file path<input value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setSourceContentType(""); }} placeholder="https://... or file:///C:/..." autoFocus /></label>
      <div className="source-editor-actions"><label className="browser-file">Choose file<input type="file" accept="video/*,image/*,application/pdf" onChange={chooseBrowserFile} /></label><button className="save-source" type="submit" disabled={!sourceUrl.trim()}>Show in widget</button></div>
      <p>Links and selected files are saved on this device. Video files play in the widget; web links and PDFs open inside it.</p>
    </form>
  </div>}</>;
}
