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
    }),
  ],
  callbacks: {
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
