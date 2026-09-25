// 业务文件二：本地存储
// 负责预置数据（三段节目、四批弹药、六个发射节点）与 localStorage 读写。
// 数据只留在浏览器：刷新后仍在，清空时恢复预置场次。

import type { SettlementState } from "./settlement";

export const STORAGE_KEY = "hxyfront-62008.settlement.v1";

export function createSeedState(): SettlementState {
  return {
    segments: [
      { id: "seg-intro", name: "Intro 引子", musicCue: "00:00 入场低音", signed: false },
      { id: "seg-chorus", name: "Chorus A 主歌烟花", musicCue: "01:05 鼓点", signed: false },
      { id: "seg-finale", name: "Finale 终场", musicCue: "03:38 尾奏", signed: false },
    ],
    batches: [
      { id: "b1", label: "30mm 扇形架", spec: "30mm", total: 24 },
      { id: "b2", label: "75mm 礼花弹", spec: "75mm", total: 12 },
      { id: "b3", label: "罗马烛光", spec: "20mm", total: 30 },
      { id: "b4", label: "冷焰火", spec: "舞台级", total: 18 },
    ],
    nodes: [
      {
        id: "n1",
        seq: 1,
        point: "A 左岸",
        batchId: "b1",
        segmentId: "seg-intro",
        plannedTime: "00:12.500",
        actualTime: "00:12.600",
        result: "fired",
        safetyConfirmed: true,
      },
      {
        id: "n2",
        seq: 2,
        point: "B 中台",
        batchId: "b1",
        segmentId: "seg-intro",
        plannedTime: "00:18.000",
        actualTime: "00:18.100",
        result: "fired",
        safetyConfirmed: true,
      },
      {
        id: "n3",
        seq: 3,
        point: "B 中台",
        batchId: "b2",
        segmentId: "seg-chorus",
        plannedTime: "01:08.200",
        actualTime: "01:08.300",
        result: "fired",
        safetyConfirmed: true,
      },
      {
        // 预置一个补录时刻：与 A 点 n1 间隔不足 1.2 秒，结算时会被拦下。
        id: "n4",
        seq: 4,
        point: "A 左岸",
        batchId: "b2",
        segmentId: "seg-chorus",
        plannedTime: "01:24.000",
        actualTime: "00:13.500",
        result: "dud",
        safetyConfirmed: false,
      },
      {
        id: "n5",
        seq: 5,
        point: "C 近景区",
        batchId: "b3",
        segmentId: "seg-finale",
        plannedTime: "03:42.000",
        actualTime: "",
        result: "",
        safetyConfirmed: false,
      },
      {
        id: "n6",
        seq: 6,
        point: "C 近景区",
        batchId: "b4",
        segmentId: "seg-finale",
        plannedTime: "03:50.000",
        actualTime: "",
        result: "",
        safetyConfirmed: false,
      },
    ],
  };
}

/** 粗略校验存档结构，避免损坏的 localStorage 数据导致页面白屏。 */
function isSettlementState(value: unknown): value is SettlementState {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    Array.isArray(data.segments) &&
    Array.isArray(data.batches) &&
    Array.isArray(data.nodes) &&
    data.nodes.every((node) => {
      const item = node as Record<string, unknown>;
      return (
        typeof item.id === "string" &&
        typeof item.point === "string" &&
        typeof item.batchId === "string" &&
        typeof item.segmentId === "string" &&
        typeof item.plannedTime === "string"
      );
    })
  );
}

export function loadState(): SettlementState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    const parsed: unknown = JSON.parse(raw);
    if (isSettlementState(parsed)) return parsed;
    return createSeedState();
  } catch {
    return createSeedState();
  }
}

export function saveState(state: SettlementState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式或配额受限时静默失败，当前会话仍可继续结算。
  }
}

export function clearState(): SettlementState {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return createSeedState();
}
