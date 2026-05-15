import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { auth, signOut } from "@/auth";
import SidebarNav from "@/app/components/SidebarNav";
import ThemeProvider from "@/app/components/ThemeProvider";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* data-theme 초기화 — hydration 전 flash 방지
          suppressHydrationWarning: 인라인 스크립트가 data-theme을 미리 세팅하므로
          서버 HTML과 클라이언트 DOM의 attribute 불일치는 의도된 것. */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.setAttribute('data-theme',localStorage.getItem('cc-theme')||'dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex">
        <ThemeProvider>
          <SidebarNav
            user={session?.user}
            logoutAction={async () => {
              "use server";
              await signOut({ redirectTo: "/api/auth/signin" });
            }}
          />

          {/* 메인 콘텐츠 */}
          <div className="flex-1 min-w-0">
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
