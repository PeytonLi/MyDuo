import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyDuo — Your meeting copilot",
  description: "A private, memory-aware copilot for live meetings.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
