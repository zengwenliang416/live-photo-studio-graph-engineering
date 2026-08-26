import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthGate } from "../components/auth/auth-gate.js";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live Photo Studio",
  description:
    "上传照片生成系列图片与轻动态素材，并导出供 iOS 导入器使用的资源包。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return (
    <html lang="zh-CN">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
