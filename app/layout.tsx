import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "아몬드영 AI 음성 실장",
  description: "미용실의 구매와 재고를 대신 관리하는 AI 직원 시연",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
