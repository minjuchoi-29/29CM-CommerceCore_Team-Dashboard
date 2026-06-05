import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  // Vercel preview 환경 — auth bypass (verification 용도).
  // VERCEL_ENV 는 Vercel 이 자동 주입하는 시스템 env var ("production" | "preview" | "development").
  // production 배포는 영향 받지 않음.
  if (process.env.VERCEL_ENV === "preview") return

  const isLoggedIn = !!req.auth
  const isSignInPage = req.nextUrl.pathname === "/signin"

  if (!isLoggedIn && !isSignInPage) {
    return NextResponse.redirect(new URL("/signin", req.url))
  }

  if (isLoggedIn && isSignInPage) {
    return NextResponse.redirect(new URL("/", req.url))
  }
})

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
}
