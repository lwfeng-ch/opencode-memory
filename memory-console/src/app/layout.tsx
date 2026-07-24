import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Memory Governance Console",
  description: "opencode-memory governance platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black text-zinc-100 antialiased">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
