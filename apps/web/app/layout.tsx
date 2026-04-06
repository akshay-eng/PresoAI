import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Pacifico } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const pacifico = Pacifico({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-logo",
  display: "swap",
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
      <body className={`${jakarta.className} ${jakarta.variable} ${pacifico.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
