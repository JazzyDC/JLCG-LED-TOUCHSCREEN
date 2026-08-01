import type { WidgetConfig } from "@/types/widgets";

export const CANVAS_SIZE = { width: 4500, height: 2500 } as const;

export const widgets: WidgetConfig[] = [
  {
    id: "camera-north",
    title: "Demo CCTV Feed - Camera 01",
    type: "cctv",
    icon: "O",
    x: 180,
    y: 170,
    width: 1240,
    height: 760,
    accent: "cyan",
    source: {
      label: "Online CCTV demo",
      url: "https://assets.mixkit.co/videos/31372/31372-720.mp4",
      contentType: "video/mp4",
    },
    refreshInterval: 30000,
  },
  {
    id: "camera-lobby",
    title: "Security Monitor Room - Camera 02",
    type: "cctv",
    icon: "O",
    x: 1540,
    y: 170,
    width: 1240,
    height: 760,
    accent: "emerald",
    source: {
      label: "Online CCTV demo",
      url: "https://assets.mixkit.co/videos/22997/22997-720.mp4",
      contentType: "video/mp4",
    },
    refreshInterval: 30000,
  },
  { id: "briefing", title: "JLCG Profile Deck - Presentation 01", type: "presentation", icon: "P", x: 180, y: 1080, width: 1240, height: 760, accent: "violet", source: { url: "/pdf/jlcg-profile-deck-032026.pdf", label: "JLCG Profile Deck - March 2026", contentType: "application/pdf", pages: 16 } },
  { id: "planning", title: "Third-Party Presentation - YouTube", type: "youtube", icon: "Y", x: 1540, y: 1080, width: 1240, height: 760, accent: "violet", source: { url: "https://www.youtube.com/watch?v=FMPq7aG-CrM&t=2s", label: "Third-party YouTube" } },
  { id: "internal-video", title: "Internal Communications", type: "video", icon: "P", x: 2900, y: 170, width: 1240, height: 760, accent: "amber", source: { url: "/videos/jet-legaspi-annecy-loop.mp4", label: "Jet Legaspi Annecy loop", contentType: "video/mp4" } },
  { id: "city-feed", title: "City Operations Live Feed", type: "youtube", icon: "Y", x: 2900, y: 1080, width: 1240, height: 760, accent: "rose", source: { url: "https://www.youtube.com/watch?v=FMPq7aG-CrM&t=2s", label: "YouTube broadcast" } },
  { id: "mobile-app", title: "Mobile Device 01", type: "mobile", icon: "M", x: 180, y: 1970, width: 1240, height: 460, accent: "cyan", source: { label: "Android screen control 01" } },
  { id: "operations", title: "Mobile Device 02", type: "mobile", icon: "M", x: 1540, y: 1970, width: 1240, height: 460, accent: "emerald", source: { label: "Android screen control 02" } },
];
