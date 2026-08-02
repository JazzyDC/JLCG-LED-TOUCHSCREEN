"use client";

import { type ChangeEvent, useEffect, useState } from "react";
import { TouchCanvas } from "@/components/canvas/TouchCanvas";
import { Widget } from "@/components/widget/Widget";
import { widgets } from "@/data/widgets";
import type { WidgetConfig } from "@/types/widgets";

const LEGACY_SOURCES = new Set([
  "https://www.canva.com/design/DAG70_Tex-U/mwourEJAaO_Snsnb1Z3V-A/view?embed",
]);
const DEMO_CCTV_SOURCES: Record<string, WidgetConfig["source"]> = {
  "camera-north": {
    label: "YouTube video feed",
    url: "https://www.youtube.com/watch?v=oUTKwSBvBhI",
    secondaryUrl: "https://www.youtube.com/watch?v=xjhneAqERqU",
  },
  "camera-lobby": {
    label: "YouTube video feed",
    url: "https://www.youtube.com/watch?v=VR-x3HdhKLQ",
    secondaryUrl: "https://www.youtube.com/watch?v=UemFRPrl1hk",
  },
};
const DEFAULT_FIXED_SOURCES: Record<string, Pick<WidgetConfig, "type" | "source">> = {
  briefing: {
    type: "presentation",
    source: { url: "/pdf/jlcg-profile-deck-032026.pdf", label: "JLCG Profile Deck - March 2026", contentType: "application/pdf", pages: 16 },
  },
  "internal-video": {
    type: "video",
    source: { url: "/assets/DEMO%20JLCG%20VIDEO.mp4", label: "DEMO JLCG VIDEO", contentType: "video/mp4" },
  },
  "city-feed": {
    type: "youtube",
    source: { url: "https://www.youtube.com/watch?v=FMPq7aG-CrM&t=2s", label: "YouTube broadcast" },
  },
  planning: {
    type: "presentation",
    source: { url: "/pdf/QCDRRMO%20PALARO.pdf", label: "QCDRRMO PALARO", contentType: "application/pdf" },
  },
  training: {
    type: "presentation",
    source: { url: "/pdf/QCDRRMO%20TRAINING.pdf", label: "QCDRRMO TRAINING", contentType: "application/pdf" },
  },
};
const DEFAULT_WIDGET_LAYOUT = new Map(widgets.map(({ id, title, type, icon, x, y, width, height, accent, source }) => [id, { title, type, icon, x, y, width, height, accent, source }]));
const applyDefaultWidgetLayout = (screen: WidgetConfig): WidgetConfig => {
  const layout = DEFAULT_WIDGET_LAYOUT.get(screen.id);
  if (!layout) return screen;
  const forceSource = screen.id === "mobile-app" || screen.id === "operations";
  return { ...screen, ...layout, source: forceSource ? layout.source : (screen.source ?? layout.source) };
};
const OLD_DEFAULT_SOURCE_URLS = new Set(["", "/pdf/JLCG%20Profile%20Deck%20032026.pdf", "/videos/operations-update.mp4", "https://www.youtube-nocookie.com/embed/21X5lGlDOfg?autoplay=0&rel=0", "https://www.youtube-nocookie.com/embed/21X5lGlDOfg?autoplay=1&mute=1&playsinline=1&rel=0"]);
const needsDefaultSource = (screen: WidgetConfig) => {
  if (!DEFAULT_FIXED_SOURCES[screen.id]) return false;
  const url = screen.source?.url ?? "";
  if (OLD_DEFAULT_SOURCE_URLS.has(url) || url.startsWith("blob:")) return true;
  if (screen.id === "briefing") return url.includes("/pdf/jlcg-profile-deck-032026.pdf") ? screen.source?.pages !== 16 : !url.includes("canva.com") && !url.includes("canva.link");
  if (screen.id === "internal-video") return !url.includes("/assets/DEMO%20JLCG%20VIDEO.mp4");
  if (screen.id === "city-feed") return getYoutubeId(new URL(withProtocol(url))) === "21X5lGlDOfg" || !getYoutubeId(new URL(withProtocol(url)));
  if (screen.id === "planning") return !url.includes("/pdf/QCDRRMO%20PALARO.pdf");
  if (screen.id === "training") return !url.includes("/pdf/QCDRRMO%20TRAINING.pdf");
  return false;
};
const applyBundledDefaultSource = (screen: WidgetConfig) => {
  try {
    return needsDefaultSource(screen) ? { ...screen, ...DEFAULT_FIXED_SOURCES[screen.id] } : screen;
  } catch {
    return DEFAULT_FIXED_SOURCES[screen.id] ? { ...screen, ...DEFAULT_FIXED_SOURCES[screen.id] } : screen;
  }
};

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
const normalizeSourceUrl = (raw: string) => {
  const value = raw.trim();
  try {
    const url = new URL(withProtocol(value));
    const host = url.hostname.replace(/^www\./, "");
    const youtubeId = getYoutubeId(url);
    if (youtubeId) {
      const embed = new URL(`https://www.youtube-nocookie.com/embed/${youtubeId}`);
      embed.searchParams.set("rel", "0");
      const start = url.searchParams.get("start") ?? url.searchParams.get("t");
      if (start) embed.searchParams.set("start", start.replace(/\D+$/g, ""));
      return embed.toString();
    }
    if (host === "canva.com" && url.pathname.startsWith("/design/")) {
      const embed = canvaEmbedUrl(url);
      if (embed) return embed;
    }
  } catch {
    return value;
  }
  return value;
};
const editableSourceUrl = (raw = "") => {
  try {
    const url = new URL(withProtocol(raw));
    const youtubeId = getYoutubeId(url);
    if (!youtubeId) return raw;
    const watch = new URL("https://www.youtube.com/watch");
    watch.searchParams.set("v", youtubeId);
    const start = url.searchParams.get("start") ?? url.searchParams.get("t");
    if (start) watch.searchParams.set("t", `${start.replace(/\D+$/g, "")}s`);
    return watch.toString();
  } catch {
    return raw;
  }
};
const normalizeSourceUrlAsync = async (raw: string) => {
  const value = normalizeSourceUrl(raw);
  try {
    const url = new URL(withProtocol(value));
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "canva.link") return value;
    const response = await fetch(`/api/resolve-canva?url=${encodeURIComponent(url.toString())}`);
    const data = await response.json() as { url?: string };
    return data.url || value;
  } catch {
    return value;
  }
};
const resourceType = (url: string, contentType = ""): WidgetConfig["type"] => {
  if (contentType.startsWith("video/") || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(url)) return "video";
  try {
    return getYoutubeId(new URL(withProtocol(url))) ? "youtube" : "presentation";
  } catch {
    return "presentation";
  }
};
const sourceLabel = (url: string) => {
  try {
    const host = new URL(withProtocol(url)).hostname.replace(/^www\./, "");
    if (host.includes("youtube")) return "YouTube presentation";
    if (host === "canva.com" || host === "canva.link") return "Canva presentation";
  } catch {
    // Keep the file-name fallback below for local paths and object URLs.
  }
  return url.split(/[\\/]/).pop() || "Custom source";
};

export default function Home() {
  const [screens, setScreens] = useState<WidgetConfig[]>(widgets);
  const [displayMode, setDisplayMode] = useState<"single" | "grid">("grid");
  const [selectedScreenId, setSelectedScreenId] = useState(widgets[0].id);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [sourceScreenId, setSourceScreenId] = useState(widgets[0].id);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceContentType, setSourceContentType] = useState("");
  const [savingSource, setSavingSource] = useState(false);
  const [introVisible, setIntroVisible] = useState(true);
  const [introStage, setIntroStage] = useState<"start" | "welcome" | "leaving">("start");

  useEffect(() => {
    const saved = window.localStorage.getItem("jlcg-widget-sources");
    if (!saved) return;
    try {
      const stored = JSON.parse(saved) as WidgetConfig[];
      const cleaned = widgets.map((defaultScreen) => {
        const screen = stored.find((item) => item.id === defaultScreen.id) ?? defaultScreen;
        if (DEMO_CCTV_SOURCES[screen.id]) return applyDefaultWidgetLayout({ ...screen, type: "youtube", source: DEMO_CCTV_SOURCES[screen.id] });
        if (LEGACY_SOURCES.has(screen.source?.url ?? "")) return { ...screen, source: { label: "Presentation source not set" } };
        return applyBundledDefaultSource(applyDefaultWidgetLayout(screen));
      });
      setScreens(cleaned);
      window.localStorage.setItem("jlcg-widget-sources", JSON.stringify(cleaned));
      void Promise.all(cleaned.map(async (screen) => {
        if (!screen.source?.url) return screen;
        const url = await normalizeSourceUrlAsync(screen.source.url);
        const type = resourceType(url, screen.source.contentType);
        if (url === screen.source.url && type === screen.type) return screen;
        return { ...screen, type, source: { ...screen.source, url, label: sourceLabel(url) } };
      })).then((resolved) => {
        if (!resolved.some((screen, index) => screen !== cleaned[index])) return;
        setScreens(resolved);
        window.localStorage.setItem("jlcg-widget-sources", JSON.stringify(resolved));
      });
    } catch {
      window.localStorage.removeItem("jlcg-widget-sources");
    }
  }, []);

  const saveSource = async (url: string) => {
    setSavingSource(true);
    const value = await normalizeSourceUrlAsync(url);
    if (!value) { setSavingSource(false); return; }
    setScreens((current) => {
      const next = current.map((screen) => screen.id === sourceScreenId ? {
        ...screen,
        type: resourceType(value, sourceContentType),
        source: { ...screen.source, url: value, contentType: sourceContentType || undefined, label: sourceLabel(value) },
      } : screen);
      window.localStorage.setItem("jlcg-widget-sources", JSON.stringify(next));
      return next;
    });
    setSelectedScreenId(sourceScreenId);
    setDisplayMode("single");
    setSavingSource(false);
    setSourceEditorOpen(false);
  };
  const chooseBrowserFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) { setSourceUrl(URL.createObjectURL(file)); setSourceContentType(file.type); }
  };

  const moveScreen = (id: string, x: number, y: number) => {
    setScreens((current) => current.map((screen) => screen.id === id ? { ...screen, x, y } : screen));
  };
  const selectScreen = (id: string) => {
    setSelectedScreenId(id);
  };
  const openSourceEditor = (id: string) => {
    const rawScreen = screens.find((item) => item.id === id) ?? screens[0];
    const screen = applyBundledDefaultSource(rawScreen);
    if (screen !== rawScreen) {
      setScreens((current) => {
        const next = current.map((item) => item.id === screen.id ? screen : item);
        window.localStorage.setItem("jlcg-widget-sources", JSON.stringify(next));
        return next;
      });
    }
    setSourceScreenId(screen.id);
    setSourceUrl(editableSourceUrl(screen.source?.url ?? ""));
    setSourceContentType(screen.source?.contentType ?? "");
    setSourceEditorOpen(true);
  };
  const changeSourceEditorScreen = (id: string) => {
    const screen = applyBundledDefaultSource(screens.find((item) => item.id === id) ?? screens[0]);
    setSourceScreenId(screen.id);
    setSourceUrl(editableSourceUrl(screen.source?.url ?? ""));
    setSourceContentType(screen.source?.contentType ?? "");
  };
  const startApp = () => {
    setIntroStage("welcome");
    window.setTimeout(() => setIntroStage("leaving"), 2600);
    window.setTimeout(() => setIntroVisible(false), 3150);
  };

  const selectedScreen = screens.find((screen) => screen.id === selectedScreenId) ?? screens[0];
  const changeDisplayMode = (mode: "single" | "grid") => {
    if (mode === "grid") {
      setScreens((current) => current.map((screen) => applyDefaultWidgetLayout(screen)));
    }
    setDisplayMode(mode);
  };

  return <>{!introVisible && <TouchCanvas
    screens={screens}
    displayMode={displayMode}
    selectedScreenId={selectedScreenId}
    onDisplayModeChange={changeDisplayMode}
    onSelectScreen={selectScreen}
    onMoveScreen={moveScreen}
    onOpenSourceEditor={openSourceEditor}
    singleScreen={screens.map((screen) => <div key={screen.id} className={`single-preserve ${screen.id === selectedScreen.id ? "is-active" : ""}`}><Widget widget={screen} /></div>)}
  >
    {screens.map((widget: WidgetConfig) => <Widget key={widget.id} widget={widget} />)}
  </TouchCanvas>}
  {introVisible && <section className={`opening-screen is-${introStage}`} aria-label="Welcome screen">
    <div className="demo-branding" aria-label="QC DRRMO and JLCG">
      <div className="demo-brand-logo-group">
        <img className="demo-brand-logo demo-brand-logo-qcdrrmo" src="/assets/qcdrrmo-palaro-logo.png" alt="QC DRRMO" />
        <img className="demo-brand-logo" src="/assets/jlcg-logo.png" alt="JLCG" />
      </div>
    </div>
    {introStage === "start" ? <button className="tap-start" type="button" onClick={startApp}>TAP TO START</button> : <div className="opening-welcome" aria-live="polite">
      <h1>Welcome</h1>
      <p className="opening-subtitle">JLCG Touchscreen LED Demo for QC DRRMO</p>
      
    </div>}
  </section>}
  {sourceEditorOpen && <div className="source-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="source-editor-title">
    <form className="source-editor" onSubmit={(event) => { event.preventDefault(); void saveSource(sourceUrl); }}>
      <header><div><small>WIDGET SOURCE</small><h2 id="source-editor-title">Set a link or local file</h2></div><button type="button" onClick={() => setSourceEditorOpen(false)} aria-label="Close source editor">×</button></header>
      <label>Widget<select value={sourceScreenId} onChange={(event) => { const id = event.target.value; setSourceScreenId(id); setSourceUrl(screens.find((screen) => screen.id === id)?.source?.url ?? ""); }}>{screens.map((screen, index) => <option key={screen.id} value={screen.id}>{String(index + 1).padStart(2, "0")} — {screen.title}</option>)}</select></label>
      <label>Web link or file path<input value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setSourceContentType(""); }} placeholder="https://... or file:///C:/..." autoFocus /></label>
      <div className="source-editor-actions"><label className="browser-file">Choose file<input type="file" accept="video/*,image/*,application/pdf" onChange={chooseBrowserFile} /></label><button className="save-source" type="submit" disabled={!sourceUrl.trim() || savingSource}>{savingSource ? "Loading link..." : "Show in widget"}</button></div>
      <p>Links and selected files are saved on this device. Video files play in the widget; web links and PDFs open inside it.</p>
    </form>
  </div>}</>;
}
