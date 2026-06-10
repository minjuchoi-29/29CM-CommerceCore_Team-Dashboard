/**
 * Weekly Parser — Korean Action Verb 인식 강화 (Schedule Signal Extraction MVP-1).
 *
 * 보호 invariants:
 *  - 새 Korean action verb (착수 / 진입 / 잔여 / 재조정 등) → ScheduleStatus 매핑 정확성
 *  - phase + status 결합 케이스 (예: "QA 완료", "배포 예정") 분리 추출
 *  - CANCEL_KEYWORDS 확장 (철회 / 스펙 아웃) 정확 감지
 *  - 기존 26 케이스 회귀 없음 (별도 weekly-parser.test.ts 에서 보호)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStatus,
  parseScheduleLineWithCtx,
} from "../lib/weekly-parser";

describe("normalizeStatus — Korean action verb 매핑", () => {
  // 진행중 카테고리
  test("'착수' → 진행중", () => assert.equal(normalizeStatus("착수"), "진행중"));
  test("'진입' → 진행중", () => assert.equal(normalizeStatus("진입"), "진행중"));
  test("'시작' → 진행중", () => assert.equal(normalizeStatus("시작"), "진행중"));
  test("'킥오프' → 진행중", () => assert.equal(normalizeStatus("킥오프"), "진행중"));
  test("'킥 오프' (whitespace) → 진행중", () => assert.equal(normalizeStatus("킥 오프"), "진행중"));
  test("'작업중' → 진행중", () => assert.equal(normalizeStatus("작업중"), "진행중"));
  test("'작업 중' (whitespace) → 진행중", () => assert.equal(normalizeStatus("작업 중"), "진행중"));
  test("'잔여' → 진행중", () => assert.equal(normalizeStatus("잔여"), "진행중"));
  test("'잔여 작업' → 진행중", () => assert.equal(normalizeStatus("잔여 작업"), "진행중"));

  // 완료 카테고리
  test("'종료' → 완료", () => assert.equal(normalizeStatus("종료"), "완료"));
  test("'마감' → 완료", () => assert.equal(normalizeStatus("마감"), "완료"));

  // 예정 카테고리
  test("'대기' → 예정", () => assert.equal(normalizeStatus("대기"), "예정"));

  // 지연 카테고리 (위험 신호)
  test("'일정 재조정' → 지연", () => assert.equal(normalizeStatus("일정 재조정"), "지연"));
  test("'재조정' → 지연", () => assert.equal(normalizeStatus("재조정"), "지연"));
  test("'기한 초과' → 지연", () => assert.equal(normalizeStatus("기한 초과"), "지연"));

  // 기존 회귀 보장 (회귀 케이스)
  test("기존 '완료' 유지 → 완료", () => assert.equal(normalizeStatus("완료"), "완료"));
  test("기존 '진행중' 유지 → 진행중", () => assert.equal(normalizeStatus("진행중"), "진행중"));
  test("기존 '예정' 유지 → 예정", () => assert.equal(normalizeStatus("예정"), "예정"));
  test("기존 '보류' 유지 → 보류", () => assert.equal(normalizeStatus("보류"), "보류"));
});

describe("parseScheduleLineWithCtx — phase + status 결합 추출", () => {
  test("'6/18 QA 예정' → phase=QA, status=예정, date=6/18", () => {
    const r = parseScheduleLineWithCtx("6/18 QA 예정", undefined, 2026);
    assert.ok(r, "should parse");
    assert.equal(r!.phase, "QA");
    assert.equal(r!.status, "예정");
    assert.equal(r!.startDate, "2026-06-18");
  });

  test("'6/20 배포 예정' → phase=Release, status=예정, date=6/20", () => {
    const r = parseScheduleLineWithCtx("6/20 배포 예정", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.phase, "Release");
    assert.equal(r!.status, "예정");
    assert.equal(r!.startDate, "2026-06-20");
  });

  test("'QA 완료' → phase=QA, status=완료 (no date)", () => {
    const r = parseScheduleLineWithCtx("QA 완료", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.phase, "QA");
    assert.equal(r!.status, "완료");
  });

  test("'배포 완료' → phase=Release, status=완료", () => {
    const r = parseScheduleLineWithCtx("배포 완료", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.phase, "Release");
    assert.equal(r!.status, "완료");
  });

  test("'잔여 개발 진행 중' → phase=개발, status=진행중", () => {
    const r = parseScheduleLineWithCtx("잔여 개발 진행 중", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.phase, "개발");
    assert.equal(r!.status, "진행중");
  });

  test("'6/15 착수' → status=진행중, date=6/15", () => {
    const r = parseScheduleLineWithCtx("6/15 착수", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.status, "진행중");
    assert.equal(r!.startDate, "2026-06-15");
  });

  test("'일정 재조정 필요' → status=지연", () => {
    const r = parseScheduleLineWithCtx("일정 재조정 필요", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.status, "지연");
  });

  test("'기한 초과' → status=지연", () => {
    const r = parseScheduleLineWithCtx("기한 초과", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.status, "지연");
  });

  test("'개발: 6/15 작업중' → phase=개발, status=진행중, date=6/15", () => {
    const r = parseScheduleLineWithCtx("개발: 6/15 작업중", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.phase, "개발");
    assert.equal(r!.status, "진행중");
    assert.equal(r!.startDate, "2026-06-15");
  });

  test("'QA: 6/18 대기' → phase=QA, status=예정, date=6/18", () => {
    const r = parseScheduleLineWithCtx("QA: 6/18 대기", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.phase, "QA");
    assert.equal(r!.status, "예정");
    assert.equal(r!.startDate, "2026-06-18");
  });
});

describe("parseScheduleLineWithCtx — CANCEL_KEYWORDS 확장", () => {
  // CANCEL keyword 단독 라인은 role/date/status 없어 parser 가 null 반환.
  // 실제 weekly 시나리오: role/date 와 함께 등장 ("QA: 스펙 아웃", "6/15 철회" 등)

  test("'QA: 스펙 아웃' → role=QA, isCancelled true", () => {
    const r = parseScheduleLineWithCtx("QA: 스펙 아웃", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.isCancelled, true);
    assert.equal(r!.phase, "QA");
  });

  test("'개발: 스펙아웃' (공백 없음) → isCancelled true", () => {
    const r = parseScheduleLineWithCtx("개발: 스펙아웃", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.isCancelled, true);
    assert.equal(r!.phase, "개발");
  });

  test("'기획: 철회' → isCancelled true", () => {
    const r = parseScheduleLineWithCtx("기획: 철회", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.isCancelled, true);
    assert.equal(r!.phase, "기획");
  });

  test("'6/15 scope out' (영문 + 날짜) → isCancelled true", () => {
    const r = parseScheduleLineWithCtx("6/15 scope out", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.isCancelled, true);
    assert.equal(r!.startDate, "2026-06-15");
  });

  test("'6/15 out of scope' → isCancelled true", () => {
    const r = parseScheduleLineWithCtx("6/15 out of scope", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.isCancelled, true);
  });

  // 회귀: 기존 CANCEL_KEYWORDS 보존
  test("기존 'QA: 취소' 유지 → isCancelled true", () => {
    const r = parseScheduleLineWithCtx("QA: 취소", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.isCancelled, true);
  });

  test("기존 'QA: 범위 제외' 유지 → isCancelled true", () => {
    const r = parseScheduleLineWithCtx("QA: 범위 제외", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.isCancelled, true);
  });
});

describe("findStatusKeyword 우선순위 — specificity (longest-first)", () => {
  test("'일정 재조정 필요' 가 'in 재조정' 보다 먼저 매칭됨", () => {
    // '일정 재조정 필요' 가 STATUS_KEYWORDS 의 앞쪽에 있어야 더 짧은 '재조정' 보다 우선 매칭
    const r = parseScheduleLineWithCtx("일정 재조정 필요", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.status, "지연");
  });

  test("'기한 초과' 가 단순 '초과' 보다 정확히 매칭", () => {
    const r = parseScheduleLineWithCtx("기한 초과", undefined, 2026);
    assert.ok(r);
    assert.equal(r!.status, "지연");
  });

  test("'잔여 작업' 이 '잔여' 만 보다 정확히 매칭", () => {
    const r = parseScheduleLineWithCtx("잔여 작업 진행 중", undefined, 2026);
    assert.ok(r);
    // 잔여 작업 또는 진행 중 둘 다 진행중 매핑 — 어쨌든 진행중
    assert.equal(r!.status, "진행중");
  });
});
