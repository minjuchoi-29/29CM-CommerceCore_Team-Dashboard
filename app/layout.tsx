import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { auth, signOut } from "@/auth";
import SidebarNav from "@/app/components/SidebarNav";
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
    >
      <body className="min-h-full flex">
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
      </body>
    </html>
  );
}
