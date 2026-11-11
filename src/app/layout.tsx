import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import NavTabs from "@/components/NavTabs";
import "./globals.css";

const brand = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-brand" });

export const metadata: Metadata = {
  title: "SecondMint",
  description: "See where failed renewals lose money, then test whether PayPal recovers more.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={brand.variable}>
      <body className="min-h-screen font-sans antialiased">
        <header className="bg-navy text-white">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-4" aria-label="Main">
            <span className="text-xl font-bold tracking-tight">SecondMint</span>
            <NavTabs />
            <span className="ml-auto text-xs text-white/70">Built on PayPal</span>
          </nav>
        </header>
        <div role="note" className="bg-warn-bg text-warn">
          <p className="mx-auto max-w-7xl px-6 py-2 text-sm font-medium">Sandbox data · simulated outcomes</p>
        </div>
        <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
