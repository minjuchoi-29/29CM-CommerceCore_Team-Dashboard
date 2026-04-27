import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

const ALLOWED_DOMAINS = ["29cm.co.kr", "musinsa.com"]

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/spreadsheets",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async jwt({ token, account }: any) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }
      // 만료 1분 전이면 갱신
      if (token.expiresAt && Date.now() / 1000 < (token.expiresAt as number) - 60) {
        return token;
      }
      if (!token.refreshToken) return token;
      try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: "refresh_token",
            refresh_token: token.refreshToken as string,
          }),
        });
        const refreshed = await res.json();
        if (!res.ok) throw refreshed;
        token.accessToken = refreshed.access_token;
        token.expiresAt = Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 3600);
      } catch (e) {
        console.error("[auth] token refresh failed:", e);
      }
      return token;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session({ session, token }: any) {
      session.accessToken = token.accessToken;
      return session;
    },
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
      const email = profile?.email ?? ""
      return ALLOWED_DOMAINS.some((domain) => email.endsWith(`@${domain}`))
    },
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
})
