"use client";
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "dark", toggle: () => {} });

export function useTheme() { return useContext(ThemeCtx); }

// PR-Light-1 (운영 검증용): Light Mode 최초 진입 시 1회만 console 안내.
// 페이지 lifetime 단위 (새로고침 시 초기화) — 운영자가 toggle 후 시각 이슈 보고
// 채널 안내. module-level flag 라 같은 세션 내 반복 toggle 해도 1회만 출력.
let __lightModeNoticeShown = false;
function notifyLightModeOnce() {
  if (__lightModeNoticeShown) return;
  __lightModeNoticeShown = true;
  console.log("[Theme]\nLight Mode Enabled\nPlease report any visual issues.");
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = localStorage.getItem("cc-theme") as Theme | null;
    const initial = saved ?? "dark";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
    if (initial === "light") notifyLightModeOnce();
  }, []);

  function toggle() {
    setTheme(prev => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      localStorage.setItem("cc-theme", next);
      document.documentElement.setAttribute("data-theme", next);
      if (next === "light") notifyLightModeOnce();
      return next;
    });
  }

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}