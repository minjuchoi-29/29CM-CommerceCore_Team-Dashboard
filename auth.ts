import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ALLOWED_DOMAINS = ["29cm.co.kr", "musinsa.com"];

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  pages: {
    signIn: "/signin",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isPublic =
        nextUrl.pathname.startsWith("/api/auth") ||
        nextUrl.pathname.startsWith("/api/sheet-priorities") ||
        nextUrl.pathname.startsWith("/api/cron/") ||
        nextUrl.pathname.startsWith("/_next") ||
        nextUrl.pathname === "/signin" ||
        nextUrl.pathname === "/favicon.ico";
      if (isPublic) return true;
      return !!auth;
    },
    signIn({ profile }) {
      console.log("[signIn] email:", profile?.email);
      const domain = profile?.email?.split("@")[1] ?? "";
      console.log("[signIn] domain:", domain, "allowed:", ALLOWED_DOMAINS.includes(domain));
      return true; // 임시: 도메인 제한 해제
    },
  },
});
