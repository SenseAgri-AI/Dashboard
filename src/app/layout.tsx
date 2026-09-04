import type { Metadata, Viewport } from "next";
import { Manrope, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-display" });
const inter = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "SenseAgri — Farm Portal",
  description: "Real-time IoT sensor dashboard and farm logging for poultry operations",
  applicationName: "SenseAgri",
  appleWebApp: { capable: true, title: "SenseAgri", statusBarStyle: "default" },
  icons: { icon: "/favicon.ico", apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#002E35",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      {/* suppressHydrationWarning: browser extensions inject attributes (e.g. data-processed-*)
          onto <html> before React hydrates — a benign, expected mismatch on this element only. */}
      <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${inter.variable} h-full`}>
        <body className="min-h-full">
          <PwaRegister />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
