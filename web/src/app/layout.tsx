import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "NIFTY//TERM — Indian Stock Terminal",
  description:
    "A sharp terminal for NSE & BSE. Type any stock, get candles, volume, and key stats instantly.",
  applicationName: "NIFTY//TERM",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "NIFTY//TERM — Indian Stock Terminal",
    description:
      "A sharp terminal for NSE & BSE. Live candles, volume, key stats.",
    type: "website",
    images: ["/og.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title: "NIFTY//TERM — Indian Stock Terminal",
    description: "A sharp terminal for NSE & BSE.",
    images: ["/og.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
