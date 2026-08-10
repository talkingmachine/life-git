import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "VS-1 · Подтверждённая жизнь",
  description: "Проверяемый маршрут Россия → Тирана с паспортом доказательств.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f4f5f2",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
