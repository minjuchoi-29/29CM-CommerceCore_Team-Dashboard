/**
 * lib/roadmap-access.ts
 *
 * 하위 호환 레이어 — 기존 코드가 이 파일을 import하는 경우를 위해 유지.
 * 실제 로직은 lib/auth/admin.ts 에서 관리.
 */

export {
  getAdminEmails as getRoadmapAllowedEmails,
  canAccessRoadmap as isRoadmapAllowed,
} from "@/lib/auth/admin";
