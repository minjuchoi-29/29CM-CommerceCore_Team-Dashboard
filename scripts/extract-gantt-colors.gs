/**
 * 이니셔티브 Gantt 시트에서 배경색으로 막대 시작일/종료일 추출
 *
 * [사용 방법]
 * 1. Google Spreadsheet 열기
 * 2. 메뉴 → 확장 프로그램 → Apps Script
 * 3. 이 코드 전체를 붙여넣기
 * 4. extractGanttDates() 함수 실행
 * 5. "Gantt 추출 결과" 시트에 결과 생성됨
 */

// ============================================================
// 설정
// ============================================================
const GANTT_SHEET_NAME = "이니셔티브 Gantt";
const OUTPUT_SHEET_NAME = "Gantt 추출 결과";

// 날짜 헤더가 시작되는 열 인덱스 (0-based)
// 스프레드시트 구조: A=티켓키, B=작업유형, C=담당자, D=상세작업명, E~=날짜 열
const DATE_COL_START = 4; // E열 (0-based index)

// 날짜 헤더 행 인덱스 (0-based)
const DATE_HEADER_ROW = 0; // 1행

// 작업 데이터 시작 행 인덱스 (0-based)
const DATA_START_ROW = 1; // 2행

// 배경색이 "없음"으로 판단하는 색상 (흰색 또는 null)
const EMPTY_COLORS = new Set(["#ffffff", "#ffffffff", null, ""]);

// ============================================================
// 메인 함수
// ============================================================
function extractGanttDates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ganttSheet = ss.getSheetByName(GANTT_SHEET_NAME);

  if (!ganttSheet) {
    SpreadsheetApp.getUi().alert(`"${GANTT_SHEET_NAME}" 시트를 찾을 수 없습니다.`);
    return;
  }

  const lastRow = ganttSheet.getLastRow();
  const lastCol = ganttSheet.getLastColumn();

  Logger.log(`시트 크기: ${lastRow}행 × ${lastCol}열`);

  // 전체 데이터 읽기
  const allValues = ganttSheet.getRange(1, 1, lastRow, lastCol).getValues();
  const allBgs    = ganttSheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();

  // 날짜 헤더 파싱 (E열부터)
  const dateHeaders = parseDateHeaders(allValues[DATE_HEADER_ROW], lastCol);
  Logger.log(`날짜 헤더 수: ${dateHeaders.filter(d => d !== null).length}`);

  // 결과 수집
  const results = [];
  results.push(["티켓키", "작업유형(Role)", "담당자", "상세작업명", "시작일", "종료일", "영업일수", "막대색상"]);

  for (let row = DATA_START_ROW; row < lastRow; row++) {
    const rowValues = allValues[row];
    const rowBgs    = allBgs[row];

    const ticketKey  = String(rowValues[0] || "").trim();
    const role       = String(rowValues[1] || "").trim();
    const person     = String(rowValues[2] || "").trim();
    const detail     = String(rowValues[3] || "").trim();

    // 빈 행 스킵
    if (!ticketKey && !role && !person) continue;

    // 날짜 범위에서 색칠된 구간 찾기
    const segments = findColoredSegments(rowBgs, dateHeaders, DATE_COL_START, lastCol);

    if (segments.length === 0) {
      // 색칠된 막대 없음 → "미정"으로 기록
      results.push([ticketKey, role, person, detail, "", "", "", "(막대 없음)"]);
    } else {
      // 세그먼트가 여러 개일 수 있음 (이어지지 않는 막대)
      for (const seg of segments) {
        const workDays = calcWorkingDays(seg.startDate, seg.endDate);
        results.push([
          ticketKey, role, person, detail,
          seg.startDate, seg.endDate, workDays, seg.color
        ]);
      }
    }
  }

  // 결과 시트 생성/초기화
  let outSheet = ss.getSheetByName(OUTPUT_SHEET_NAME);
  if (outSheet) {
    outSheet.clearContents();
  } else {
    outSheet = ss.insertSheet(OUTPUT_SHEET_NAME);
  }

  outSheet.getRange(1, 1, results.length, results[0].length).setValues(results);
  outSheet.autoResizeColumns(1, results[0].length);

  // 헤더 강조
  outSheet.getRange(1, 1, 1, results[0].length)
    .setBackground("#4a90d9")
    .setFontColor("#ffffff")
    .setFontWeight("bold");

  Logger.log(`추출 완료: ${results.length - 1}건`);
  SpreadsheetApp.getUi().alert(`추출 완료!\n총 ${results.length - 1}건이 "${OUTPUT_SHEET_NAME}" 시트에 저장되었습니다.`);
}

// ============================================================
// 날짜 헤더 파싱
// 헤더 셀 값이 "Jan 1", "1/1", "2026-01-01", 숫자(엑셀날짜) 등 다양한 형식 지원
// ============================================================
function parseDateHeaders(headerRow, lastCol) {
  const headers = new Array(lastCol).fill(null);

  for (let col = DATE_COL_START; col < lastCol; col++) {
    const raw = headerRow[col];
    if (!raw) continue;

    let dateStr = null;

    if (raw instanceof Date) {
      dateStr = formatDate(raw);
    } else if (typeof raw === "number") {
      // 엑셀 날짜 시리얼 번호 변환
      const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
      dateStr = formatDate(d);
    } else if (typeof raw === "string" && raw.trim()) {
      // 문자열 파싱 시도: "M/D", "MM/DD", "YYYY-MM-DD", "M월 D일"
      const parsed = parseKoreanDate(raw.trim());
      if (parsed) dateStr = parsed;
    }

    headers[col] = dateStr;
  }

  return headers;
}

// ============================================================
// 색칠된 연속 구간 찾기
// ============================================================
function findColoredSegments(rowBgs, dateHeaders, startCol, endCol) {
  const segments = [];
  let segStart = null;
  let segColor = null;

  for (let col = startCol; col < endCol; col++) {
    const bg = rowBgs[col];
    const date = dateHeaders[col];
    const isEmpty = EMPTY_COLORS.has(bg ? bg.toLowerCase() : bg);

    if (!isEmpty && date) {
      if (segStart === null) {
        // 새 세그먼트 시작
        segStart = { col, date, color: bg };
        segColor = normalizeColor(bg);
      }
      // 계속 진행 (연속 색칠)
    } else {
      if (segStart !== null) {
        // 이전 세그먼트 종료
        const prevDate = dateHeaders[col - 1] || segStart.date;
        segments.push({
          startDate: segStart.date,
          endDate: prevDate,
          color: segColor,
        });
        segStart = null;
        segColor = null;
      }
    }
  }

  // 마지막 세그먼트 닫기
  if (segStart !== null) {
    const lastDate = dateHeaders[endCol - 1] || segStart.date;
    segments.push({
      startDate: segStart.date,
      endDate: lastDate,
      color: segColor,
    });
  }

  return segments;
}

// ============================================================
// 영업일 계산 (주말 + 한국 공휴일 제외)
// ============================================================
const KR_HOLIDAYS = new Set([
  // 2025
  "2025-01-01","2025-01-28","2025-01-29","2025-01-30",
  "2025-03-01","2025-05-05","2025-05-06","2025-06-06",
  "2025-08-15","2025-10-03","2025-10-05","2025-10-06","2025-10-07","2025-10-08","2025-10-09",
  "2025-12-25",
  // 2026
  "2026-01-01","2026-02-17","2026-02-18","2026-02-19",
  "2026-03-01","2026-03-02","2026-05-05","2026-05-25","2026-06-06",
  "2026-08-15","2026-08-17","2026-09-24","2026-09-25","2026-09-26",
  "2026-10-03","2026-10-09","2026-12-25",
]);

function calcWorkingDays(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  const s = new Date(startStr + "T00:00:00");
  const e = new Date(endStr + "T00:00:00");
  if (s > e) return 0;
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const day = cur.getDay();
    const iso = formatDate(cur);
    if (day !== 0 && day !== 6 && !KR_HOLIDAYS.has(iso)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ============================================================
// 유틸리티
// ============================================================
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeColor(hex) {
  if (!hex) return "";
  return hex.toLowerCase().replace(/ff$/, ""); // RGBA → RGB
}

function parseKoreanDate(str) {
  // YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;

  // M/D 또는 MM/DD (2025년 기준)
  m = str.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const year = new Date().getFullYear();
    return `${year}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  }

  // "1월 1일" 또는 "1/1일"
  m = str.match(/^(\d{1,2})월\s*(\d{1,2})일?$/);
  if (m) {
    const year = new Date().getFullYear();
    return `${year}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  }

  return null;
}

// ============================================================
// 디버그: 날짜 헤더만 출력 (선택 실행)
// ============================================================
function debugDateHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ganttSheet = ss.getSheetByName(GANTT_SHEET_NAME);
  if (!ganttSheet) return;

  const lastCol = ganttSheet.getLastColumn();
  const headerRow = ganttSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const headers = parseDateHeaders(headerRow, lastCol);

  const nonNull = headers
    .map((d, i) => d ? `col${i+1}(${String.fromCharCode(64+(i+1))}): ${d}` : null)
    .filter(Boolean);

  Logger.log("=== 날짜 헤더 ===");
  nonNull.forEach(h => Logger.log(h));
  Logger.log(`총 ${nonNull.length}개 날짜 열`);
}

// ============================================================
// 디버그: 특정 행의 배경색 출력 (선택 실행)
// ============================================================
function debugRowColors() {
  const TARGET_ROW = 5; // 확인할 행 번호 (1-based)

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ganttSheet = ss.getSheetByName(GANTT_SHEET_NAME);
  if (!ganttSheet) return;

  const lastCol = ganttSheet.getLastColumn();
  const bgs = ganttSheet.getRange(TARGET_ROW, 1, 1, lastCol).getBackgrounds()[0];
  const vals = ganttSheet.getRange(TARGET_ROW, 1, 1, lastCol).getValues()[0];

  Logger.log(`=== ${TARGET_ROW}행 배경색 ===`);
  bgs.forEach((bg, i) => {
    if (!EMPTY_COLORS.has(bg ? bg.toLowerCase() : bg)) {
      Logger.log(`col${i+1}: bg=${bg}, val=${vals[i]}`);
    }
  });
}
