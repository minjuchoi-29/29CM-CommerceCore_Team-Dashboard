import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "29CM Commerce Core Dashboard",
  description: "29CM Commerce Core Team Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex">
        {/* 좌측 사이드바 */}
        <aside className="w-52 min-h-screen bg-white border-r border-gray-200 flex flex-col shrink-0">
          <div className="px-5 py-5 border-b border-gray-100">
            <h1 className="text-sm font-bold text-gray-900">29CM</h1>
            <p className="text-xs text-gray-400 mt-0.5">Commerce Core</p>
          </div>
          <nav className="flex flex-col gap-1 p-3 mt-1">
            <Link
              href="/"
              className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              담당자별 확인하기
            </Link>
            <Link
              href="/jira-tickets"
              className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              전체 과제 보기
            </Link>
          </nav>
        </aside>

        {/* 메인 콘텐츠 */}
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </body>
    </html>
  );
}
