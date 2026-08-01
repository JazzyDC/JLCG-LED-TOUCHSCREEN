import { NextResponse } from "next/server";

const canvaEmbedUrl = (raw: string) => {
  const url = new URL(raw);
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "canva.com" || !url.pathname.startsWith("/design/")) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  const designId = parts[1];
  return designId ? `https://www.canva.com/design/${designId}/view?embed&meta` : "";
};

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url")?.trim();
  if (!source) return NextResponse.json({ url: "" }, { status: 400 });

  try {
    const sourceUrl = new URL(source);
    const host = sourceUrl.hostname.replace(/^www\./, "");

    if (host === "canva.com") return NextResponse.json({ url: canvaEmbedUrl(source) || source });
    if (host !== "canva.link") return NextResponse.json({ url: source });

    const response = await fetch(source, { redirect: "manual" });
    const location = response.headers.get("location");
    if (!location) return NextResponse.json({ url: source });

    const resolved = new URL(location, source).toString();
    return NextResponse.json({ url: canvaEmbedUrl(resolved) || resolved });
  } catch {
    return NextResponse.json({ url: source });
  }
}
