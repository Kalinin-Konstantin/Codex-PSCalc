import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIM.Seller Unit Calculator",
  description: "Unit economics calculator for marketplace sellers",
  icons: {
    apple: "/favicon-v4.png?v=4",
    icon: [
      { url: "/favicon.ico?v=4", sizes: "any" },
      { url: "/favicon-v4.png?v=4", sizes: "256x256", type: "image/png" }
    ],
    shortcut: "/favicon.ico?v=4"
  }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
