"use client";
import { useState } from "react";
import { copyTicketReference } from "@/lib/ticket-utils";

export default function TicketCopyButton({
  ticketKey,
  summary,
  size = "sm",
}: {
  ticketKey: string;
  summary: string;
  size?: "sm" | "xs";
}) {
  const [copied, setCopied] = useState(false);
  const dim = size === "xs" ? "w-3.5 h-3.5" : "w-4 h-4";

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    await copyTicketReference(ticketKey, summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleClick}
      title={copied ? "복사됨!" : "티켓 번호+제목 복사"}
      className={`shrink-0 flex items-center justify-center rounded transition-all ${
        copied ? "opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
      }`}
      style={{ color: copied ? "#34d399" : "var(--text-muted)" }}
    >
      {copied ? (
        <svg className={dim} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg className={dim} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
