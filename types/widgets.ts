export type WidgetType = "cctv" | "presentation" | "video" | "youtube" | "mobile" | "dashboard";
export interface WidgetSource { url?: string; imageUrl?: string; label?: string; contentType?: string; }
export interface WidgetConfig { id: string; title: string; type: WidgetType; icon: string; x: number; y: number; width: number; height: number; source?: WidgetSource; refreshInterval?: number; accent: "cyan" | "violet" | "emerald" | "amber" | "rose"; }
export interface CanvasBounds { width: number; height: number; }
export interface Camera { id: string; name: string; status: "online" | "offline"; }
export interface Video { id: string; title: string; source: string; }
export interface Presentation { id: string; title: string; source: string; }
export interface DashboardMetric { label: string; value: string; change: string; positive?: boolean; }
