import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
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
