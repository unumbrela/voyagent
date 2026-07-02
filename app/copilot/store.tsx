"use client";

/**
 * Copilot 共享状态（AG-UI 的「shared application state」）。
 *
 * 全站常驻的 Dock 挂在 layout，而当前行程的 days/setDays 是行程页的局部状态。
 * 行程页把一个「行程控制器」注册进来，Dock 就能读当前行程、把智能体的改动落回页面。
 * 项目未用全局状态库，这里用最轻量的 React Context + ref。
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import type { ItinDay, Reference } from "@/lib/agent/types";

export interface ItineraryController {
  getTripId: () => string;
  getTitle: () => string;
  getMeta: () => {
    destination: string | null;
    origin: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  getDays: () => ItinDay[];
  /** 应用一版新 days（压 undo 快照 + 落库保存）。references 可选。 */
  applyDays: (days: ItinDay[], references?: Reference[]) => void;
  undo: () => void;
  canUndo: () => boolean;
}

interface CopilotValue {
  registerItinerary: (c: ItineraryController | null) => void;
  getController: () => ItineraryController | null;
}

const CopilotContext = createContext<CopilotValue | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ItineraryController | null>(null);
  const registerItinerary = useCallback((c: ItineraryController | null) => {
    ref.current = c;
  }, []);
  const getController = useCallback(() => ref.current, []);
  return (
    <CopilotContext.Provider value={{ registerItinerary, getController }}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot(): CopilotValue {
  const v = useContext(CopilotContext);
  if (!v) throw new Error("useCopilot 必须在 CopilotProvider 内使用");
  return v;
}
