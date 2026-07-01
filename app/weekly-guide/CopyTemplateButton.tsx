"use client";

/**
 * Weekly 작성 포맷 복사 버튼 — /weekly-guide 페이지 안에서만 사용.
 *
 * 목적: 사용자가 가이드를 읽자마자 Jira Description / Comment 로 그대로
 * 붙여넣고 내용만 채울 수 있는 템플릿을 clipboard 로 전달.
 *
 * 동작:
 *   1) navigator.clipboard.writeText() 시도
 *   2) 실패하면 textarea + document.execCommand("copy") fallback
 *   3) 두 경로 모두 실패 시 console.warn 만 남기고 UI 상태 미변경
 *
 * 상태:
 *   idle → copied (2초) → idle
 *
 * 디자인: CSS variables 기반 — light/dark 모두 자연스러움.
 */
import { useState } from "react";

type Props = {
  template: string;
};

async function copyViaClipboardAPI(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function copyViaTextareaFallback(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function CopyTemplateButton({ template }: Props) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    // 1차: 표준 Clipboard API
    let ok = await copyViaClipboardAPI(template);
    // 2차: textarea + execCommand fallback (HTTP / iframe / 구형 브라우저 등)
    if (!ok) ok = copyViaTextareaFallback(template);

    if (!ok) {
      console.warn("[weekly-guide] clipboard copy failed — 브라우저 지원 확인 필요");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="위클리 작성 포맷을 클립보드에 복사"
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all"
      style={{
        background: copied ? "rgba(52,211,153,0.12)" : "var(--bg-item)",
        border: `1px solid ${copied ? "rgba(52,211,153,0.40)" : "var(--border-2)"}`,
        color: copied ? "#34d399" : "var(--text-secondary)",
      }}
      onMouseEnter={e => {
        if (copied) return;
        (e.currentTarget as HTMLElement).style.background = "var(--bg-item-alt)";
        (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
      }}
      onMouseLeave={e => {
        if (copied) return;
        (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
        (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
      }}
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>복사 완료</span>
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>작성 포맷 복사</span>
        </>
      )}
    </button>
  );
}
