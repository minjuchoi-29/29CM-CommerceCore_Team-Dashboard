export { auth as proxy } from "@/auth";

export const proxyConfig = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
