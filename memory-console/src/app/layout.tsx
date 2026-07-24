import type { Metadata } from "next";
import { Sora, DM_Sans, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-sora" });
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-dm" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "MemoryOS — Governance Console",
  description: "AI agent memory governance platform",
  viewport: "width=device-width, initial-scale=1, maximum-scale=5, minimum-scale=0.5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sora.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body className="bg-[#09090b] text-zinc-100 antialiased font-[family-name:var(--font-dm)]">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}