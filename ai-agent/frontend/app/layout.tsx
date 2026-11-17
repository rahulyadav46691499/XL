import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * Two roles, deliberately split.
 *
 * Plex Sans carries language — candidate names, reasoning, prose. It was drawn
 * for dense product interfaces and keeps its humanist detail at 12px, where
 * most of this UI lives.
 *
 * Plex Mono carries measurement — every score, count, threshold and eyebrow
 * label. A screening tool is an instrument, and its readings should look like
 * readings: fixed-width, vertically aligned, comparable down a column without
 * reading the digits. This is the one typographic idea the page is built on.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TalentAgent AI — EXL",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${plexSans.variable} ${plexMono.variable} font-sans`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}