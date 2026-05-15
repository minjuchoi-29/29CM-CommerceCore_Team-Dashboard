"use client";

import { useState, useRef } from "react";

interface TooltipProps {
  /** tooltip에 표시할 내용 (문자열 or ReactNode) */
  content: React.ReactNode;
  children: React.ReactNode;
  /** 표시 방향, 기본 "top" */
  side?: "top" | "bottom";
  /** 최대 너비(px), 기본 210 */
  maxWidth?: number;
  /** hover 후 표시 지연(ms), 기본 320 */
  delay?: number;
}

/**
 * 경량 인라인 Tooltip
 * - CSS variable(var(--bg-canvas) 등)로 dark/light 자동 대응
 * - 지연 표시로 빠른 마우스 이동 시 flicker 방지
 * - children 가 span/badge 형태여야 레이아웃이 깔끔함
 */
export function Tooltip({
  content,
  children,
  side = "top",
  maxWidth = 210,
  delay = 320,
}: TooltipProps) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleEnter() {
    timer.current = setTimeout(() => setShow(true), delay);
  }
  function handleLeave() {
    if (timer.current) clearTimeout(timer.current);
    setShow(false);
  }

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}

      {show && (
        <span
          className="absolute z-[9999] pointer-events-none"
          style={{
            ...(side === "top"
              ? { bottom: "calc(100% + 6px)" }
              : { top: "calc(100% + 6px)" }),
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          <span
            style={{
              display: "block",
              padding: "6px 10px",
              borderRadius: "6px",
              fontSize: "11px",
              lineHeight: "1.6",
              whiteSpace: "pre-line",
              textAlign: "left",
              maxWidth: `${maxWidth}px`,
              minWidth: "110px",
              background: "var(--bg-canvas)",
              border: "1px solid var(--border-2)",
              color: "var(--text-secondary)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.24)",
            }}
          >
            {content}
          </span>
        </span>
      )}
    </span>
  );
}
