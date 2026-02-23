import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FireCity",
  description: "Visualize any GitHub organization as a city skyline, powered by Firecrawl",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
