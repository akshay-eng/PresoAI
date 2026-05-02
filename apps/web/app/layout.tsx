import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { RouteTracker } from "@/components/route-tracker";
import "./globals.css";

// Use local system font stacks — avoids Google Fonts network calls in Docker builds
const jakarta = localFont({
  src: [
    { path: "../public/fonts/PlusJakartaSans-Variable.woff2", style: "normal" },
    { path: "../public/fonts/PlusJakartaSans-Variable-Italic.woff2", style: "italic" },
  ],
  variable: "--font-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

const logoFont = localFont({
  src: [{ path: "../public/fonts/Pacifico-Regular.woff2", style: "normal" }],
  variable: "--font-logo",
  display: "swap",
  fallback: ["cursive", "serif"],
});

export const metadata: Metadata = {
  title: "preso.ai — AI-Powered Presentation Generator",
  description: "Create stunning presentations with AI in minutes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const t=localStorage.getItem("sf-theme");if(t)document.documentElement.className=t}catch(e){}`,
          }}
        />
      </head>
      <body className={`${jakarta.className} ${jakarta.variable} ${logoFont.variable}`}>
        <Providers>
          <RouteTracker />
          {children}
        </Providers>
      </body>
    </html>
  );
}
