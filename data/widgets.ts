import type { WidgetConfig } from "@/types/widgets";
export const CANVAS_SIZE = { width: 4500, height: 2500 } as const;
export const widgets: WidgetConfig[] = [
  { id:"camera-north", title:"North Gate · Camera 01", type:"cctv", icon:"◉", x:180, y:170, width:1240, height:760, accent:"cyan", source:{label:"North perimeter"}, refreshInterval:30000 },
  { id:"camera-lobby", title:"Main Lobby · Camera 02", type:"cctv", icon:"◉", x:1540, y:170, width:1240, height:760, accent:"emerald", source:{label:"Public entry"}, refreshInterval:30000 },
  { id:"briefing", title:"Daily Operations Briefing", type:"presentation", icon:"▤", x:2900, y:170, width:1240, height:760, accent:"violet", source:{label:"Presentation 01"} },
  { id:"internal-video", title:"Internal Communications", type:"video", icon:"▶", x:180, y:1080, width:1580, height:900, accent:"amber", source:{url:"/videos/operations-update.mp4",label:"Operations update"} },
  { id:"city-feed", title:"City Operations Live Feed", type:"youtube", icon:"◈", x:1900, y:1080, width:1580, height:900, accent:"rose", source:{url:"https://www.youtube-nocookie.com/embed/21X5lGlDOfg?autoplay=0&rel=0",label:"External broadcast"} },
  { id:"mobile-app", title:"Mobile Device", type:"mobile", icon:"▯", x:180, y:2080, width:1240, height:380, accent:"cyan", source:{label:"Android screen control"} },
  { id:"planning", title:"Project Planning Deck", type:"presentation", icon:"▤", x:1540, y:2080, width:1240, height:380, accent:"violet", source:{label:"Presentation 02"} },
  { id:"operations", title:"Operations Intelligence", type:"dashboard", icon:"▦", x:2900, y:2080, width:1240, height:380, accent:"emerald", source:{label:"Live operations"}, refreshInterval:60000 },
];

widgets[0] = {
  ...widgets[0],
  title: "Playa del Duque · Camera 01",
  icon: "◉",
  source: {
    label: "Tenerife, Spain",
    url: "https://www.skylinewebcams.com/en/webcam/espana/canarias/santa-cruz-de-tenerife/playa-del-duque.html",
    imageUrl: "https://embed.skylinewebcams.com/img/1073.jpg",
  },
};

widgets[1] = {
  ...widgets[1],
  title: "Davao City · Camera 02",
  icon: "◉",
  source: {
    label: "Davao City, Philippines",
    url: "https://www.skylinewebcams.com/en/webcam/philippines/davao/davao-del-sur/davao-city.html",
    imageUrl: "https://embed.skylinewebcams.com/img/2820.jpg",
  },
};

widgets[2] = {
  ...widgets[2],
  title: "JLCG Profile Deck · Presentation 01",
  source: {
    label: "JLCG Profile Deck · March 2026",
  },
};


widgets[6] = {
  ...widgets[6],
  title: "Third-Party Presentation · Presentation 02",
  source: {
    label: "Canva presentation",
    // Canva editor URLs refuse to render in an iframe. The view URL is its
    // supported, read-only presentation surface for embedded displays.
  },
};
