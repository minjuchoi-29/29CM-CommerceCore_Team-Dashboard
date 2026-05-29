/**
 * lib/auth/admin.ts
 *
 * Product OS 접근 권한 helper (서버 전용)
 *
 * 환경변수:
 *   ADMIN_ONLY_EMAILS=minju.choi@29cm.co.kr,other@29cm.co.kr
 *
 * ADMIN_ONLY_EMAILS가 없으면 기존 ROADMAP_ALLOWED_EMAILS로 fallback.
 * 둘 다 없으면 모두 차단.
 *
 * 향후 확장:
 *   ROADMAP_ALLOWED_EMAILS  — 로드맵 전용 (현재 ADMIN_ONLY_EMAILS와 동일)
 *   RESOURCE_ALLOWED_EMAILS — 리소스 전용 (현재 ADMIN_ONLY_EMAILS와 동일)
 *   REPORTS_ALLOWED_EMAILS  — 보고서 전용
 */

import { NextResponse } from "next/server";

/** 환경변수 파싱 helper */
function parseEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** 관리자 이메일 목록 (서버 전용) */
export function getAdminEmails(): string[] {
  // ADMIN_ONLY_EMAILS 우선, 없으면 기존 ROADMAP_ALLOWED_EMAILS fallback
  const adminList = parseEmails(process.env.ADMIN_ONLY_EMAILS);
  if (adminList.length > 0) return adminList;
  return parseEmails(process.env.ROADMAP_ALLOWED_EMAILS);
}

/** 주어진 이메일이 관리자 목록에 포함되는지 확인 */
export function isAdminUser(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}

/**
 * 로드맵 접근 권한.
 * 현재는 관리자 권한과 동일. 추후 별도 ROADMAP_ALLOWED_EMAILS 로 분리 가능.
 */
export function canAccessRoadmap(email: string | null | undefined): boolean {
  if (!email) return false;
  const specific = parseEmails(process.env.ROADMAP_ALLOWED_EMAILS);
  if (specific.length > 0) return specific.includes(email.toLowerCase());
  return isAdminUser(email);
}

/**
 * 리소스 현황 접근 권한.
 * 현재는 관리자 권한과 동일. 추후 별도 RESOURCE_ALLOWED_EMAILS 로 분리 가능.
 */
export function canAccessResources(email: string | null | undefined): boolean {
  if (!email) return false;
  const specific = parseEmails(process.env.RESOURCE_ALLOWED_EMAILS);
  if (specific.length > 0) return specific.includes(email.toLowerCase());
  return isAdminUser(email);
}

/**
 * 보고서 접근 권한.
 * 현재는 관리자 권한과 동일. 추후 별도 REPORTS_ALLOWED_EMAILS 로 분리 가능.
 */
export function canAccessReports(email: string | null | undefined): boolean {
  if (!email) return false;
  const specific = parseEmails(process.env.REPORTS_ALLOWED_EMAILS);
  if (specific.length > 0) return specific.includes(email.toLowerCase());
  return isAdminUser(email);
}

/**
 * 데이터 소스 관리 접근 권한.
 * Jira Filter 등록/sync 등 데이터 파이프라인 운영 기능.
 * 현재는 관리자 권한과 동일. 추후 별도 DATA_SOURCES_ALLOWED_EMAILS 로 분리 가능.
 */
export function canAccessDataSources(email: string | null | undefined): boolean {
  if (!email) return false;
  const specific = parseEmails(process.env.DATA_SOURCES_ALLOWED_EMAILS);
  if (specific.length > 0) return specific.includes(email.toLowerCase());
  return isAdminUser(email);
}

/**
 * 모든 관리자 전용 기능 (roadmap, resources, reports 포함) 접근 여부.
 * 사이드바에서 PM 운영 섹션 노출 여부 판단에 사용.
 */
export function canAccessAdminFeatures(email: string | null | undefined): boolean {
  return isAdminUser(email);
}

/**
 * API Route 용 관리자 인증 guard.
 *
 * 향후 /api/owner-dashboard, /api/member-dashboard 등 관리자 전용 API 추가 시 사용.
 * null 반환 → 정상 통과 / NextResponse 반환 → 즉시 return 해서 요청 차단.
 *
 * 사용 예:
 *   import { auth } from "@/auth";
 *   import { adminApiGuard } from "@/lib/auth/admin";
 *   import { NextResponse } from "next/server";
 *
 *   export async function GET(req: NextRequest) {
 *     const session = await auth();
 *     const block = adminApiGuard(session?.user?.email);
 *     if (block) return block;
 *     // ... 이하 관리자 전용 로직
 *   }
 *
 * TODO [OWNER-DASHBOARD]: /api/owner-dashboard 구현 시 이 함수 사용
 */
export function adminApiGuard(
  email: string | null | undefined
): NextResponse | null {
  if (isAdminUser(email)) return null;
  return NextResponse.json(
    { error: "관리자 전용 기능입니다." },
    { status: 403 }
  );
}
