import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./hardening.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://billguarded.com"),
  title: "BillGuarded — Find the charges your 3PL should not have billed",
  description:
    "Evidence-backed 3PL invoice reconciliation for ecommerce operators.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "BillGuarded",
    title: "BillGuarded — 3PL invoice reconciliation",
    description:
      "Find duplicate charges, unsupported fees, arithmetic errors, and rate mismatches in structured 3PL billing data.",
  },
  twitter: {
    card: "summary",
    title: "BillGuarded — 3PL invoice reconciliation",
    description:
      "Evidence-backed reconciliation for structured 3PL invoices and rate cards.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
