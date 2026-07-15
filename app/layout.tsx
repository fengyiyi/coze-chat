import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "爱立方爱国主义教育启蒙智能体",
  description: "基于 Coze 智能体的流式对话，仅限授权域名访问",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
