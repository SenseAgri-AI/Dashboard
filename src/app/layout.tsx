import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-display" });
const inter = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "SenseAgri — Farm Portal",
  description: "Real-time IoT sensor dashboard and farm logging for poultry operations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      {/* suppressHydrationWarning: browser extensions inject attributes (e.g. data-processed-*)
          onto <html> before React hydrates — a benign, expected mismatch on this element only. */}
      <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${inter.variable} h-full`}>
        <body className="min-h-full">{children}</body>
      </html>
    </ClerkProvider>
  );
}
