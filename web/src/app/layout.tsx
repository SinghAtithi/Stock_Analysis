import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "NIFTY — Indian Market",
  description:
    "Clean view of NSE & BSE. Search any symbol, read candles, volume and key stats — no noise.",
  applicationName: "NIFTY",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "NIFTY — Indian Market",
    description: "Live candles, volume and key stats for NSE & BSE.",
    type: "website",
    images: ["/og/default.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "NIFTY — Indian Market",
    description: "Live candles, volume and key stats for NSE & BSE.",
    images: ["/og/default.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nifty-theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full bg-canvas text-paper">
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
