import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIM.Seller Unit Calculator",
  description: "Unit economics calculator for marketplace sellers",
  icons: {
    icon: "/pim-seller-logo.png"
  }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
