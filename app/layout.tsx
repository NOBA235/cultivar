import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cultivar — Product Intelligence for Independent Producers",
  description:
    "Upload a product catalog, resolve items against Qloo, and evaluate culturally grounded product opportunities with full evidence trails.",
  keywords: [
    "Qloo",
    "Cultural Intelligence",
    "Food Producers",
    "Product Planning",
    "Taste Graph",
    "Gemini 2.5 Flash",
    "Cultivar",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh flex flex-col justify-between font-sans antialiased text-stone-900`}
      >
        <Navbar />
        <div className="flex-1 flex flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
