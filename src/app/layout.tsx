import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { UserWidget } from "@/components/UserWidget";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KartuPay",
  description: "Coordinate social events, track budgets, and manage shared payments with your group.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="min-h-screen bg-background text-foreground">
          <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="app-shell flex items-center justify-between py-4">
              <Link href="/" className="text-lg font-semibold tracking-tight transition-colors hover:text-primary">KartuPay</Link>
              <UserWidget />
            </div>
          </header>
          <main className="app-shell py-6 md:py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
