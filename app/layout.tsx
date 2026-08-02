// app/layout.tsx
import type { Metadata } from "next";
import { Poppins, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./logo.css";
import "./display-modes.css";
import "./studio-palette.css";
import "./orange-charcoal.css";
import "./menu-position.css";
import "./responsive.css";

const poppinsFont = Poppins({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "JLCG LED",
  description: "Interactive touchscreen operations command center",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppinsFont.variable} ${monoFont.variable}`}>
      <body className="font-[var(--font-display)] bg-[#0A0E15] text-slate-100 antialiased overscroll-none">
        {children}
      </body>
    </html>
  );
}
