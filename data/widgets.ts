import type { WidgetConfig } from "@/types/widgets";

export const CANVAS_SIZE = { width: 4500, height: 2810 } as const;

export const widgets: WidgetConfig[] = [
  { id: "briefing", title: "JLCG Profile Deck - Presentation 01", type: "presentation", icon: "P", x: 180, y: 170, width: 1240, height: 760, accent: "violet", source: { url: "/pdf/jlcg-profile-deck-032026.pdf", label: "JLCG Profile Deck - March 2026", contentType: "application/pdf", pages: 16 } },
  { id: "planning", title: "QCDRRMO Palaro", type: "presentation", icon: "P", x: 1540, y: 170, width: 1240, height: 760, accent: "violet", source: { url: "/pdf/QCDRRMO%20PALARO.pdf", label: "QCDRRMO PALARO", contentType: "application/pdf" } },
  { id: "training", title: "QCDRRMO Training", type: "presentation", icon: "P", x: 2900, y: 170, width: 1240, height: 760, accent: "violet", source: { url: "/pdf/QCDRRMO%20TRAINING.pdf", label: "QCDRRMO TRAINING", contentType: "application/pdf" } },
  { id: "internal-video", title: "JLCG Demo Video", type: "video", icon: "P", x: 180, y: 1010, width: 1240, height: 760, accent: "amber", source: { url: "/assets/DEMO%20JLCG%20VIDEO.mp4", label: "DEMO JLCG VIDEO", contentType: "video/mp4" } },
  { id: "city-feed", title: "City Operations Live Feed", type: "youtube", icon: "Y", x: 1540, y: 1010, width: 1240, height: 760, accent: "rose", source: { url: "https://www.youtube.com/watch?v=FMPq7aG-CrM&t=2s", label: "YouTube broadcast" } },
  {
    id: "camera-north",
    title: "Davao City CCTV CAM",
    type: "youtube",
    icon: "O",
    x: 2900,
    y: 1010,
    width: 1240,
    height: 760,
    accent: "cyan",
    source: {
      label: "YouTube video feed",
      url: "https://www.youtube.com/watch?v=oUTKwSBvBhI",
      secondaryUrl: "https://www.youtube.com/watch?v=xjhneAqERqU",
    },
    refreshInterval: 30000,
  },
  {
    id: "camera-lobby",
    title: "THAILAND CAM",
    type: "youtube",
    icon: "O",
    x: 180,
    y: 1850,
    width: 1240,
    height: 760,
    accent: "emerald",
    source: {
      label: "YouTube video feed",
      url: "https://www.youtube.com/watch?v=VR-x3HdhKLQ",
      secondaryUrl: "https://www.youtube.com/watch?v=UemFRPrl1hk",
    },
    refreshInterval: 30000,
  },
  { id: "mobile-app", title: "Mobile Device 01", type: "mobile", icon: "M", x: 1540, y: 1850, width: 1240, height: 760, accent: "cyan", source: { label: "Android screen control 01" } },
  { id: "operations", title: "Mobile Device 02", type: "mobile", icon: "M", x: 2900, y: 1850, width: 1240, height: 760, accent: "emerald", source: { label: "Android screen control 02" } },
];
