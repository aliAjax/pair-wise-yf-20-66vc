/**
 * 业务文件二：本地存储
 * 结算数据只留在浏览器 localStorage，这里负责预置数据、读取、写入与重置。
 */
import type { ShowState } from "./settlement";

const STORAGE_KEY = "hxyfront-62008:firing-settlement:v1";

/** 预置：三段节目、四批弹药、六个发射节点、四个点位 */
export function seedState(): ShowState {
  return {
    showTitle: "江畔之夜 · 焰火晚会散场结算",
    officer: "王磊",
    segments: [
      { id: "S1", name: "开场 · 迎宾序曲", signedOff: true },
      { id: "S2", name: "中场 · 星河画卷", signedOff: false },
      { id: "S3", name: "终场 · 盛世礼赞", signedOff: false },
    ],
    batches: [
      { id: "B1", model: "银冠礼花弹", caliber: "75mm", total: 8, distance: "60m" },
      { id: "B2", model: "扇形组合盆花", caliber: "30mm", total: 12, distance: "35m" },
      { id: "B3", model: "罗马烛光", caliber: "20mm", total: 20, distance: "25m" },
      { id: "B4", model: "冷焰火喷泉", caliber: "3m 喷口", total: 16, distance: "15m" },
    ],
    positions: [
      { id: "P1", name: "一号位", x: 22, y: 24 },
      { id: "P2", name: "二号位", x: 74, y: 22 },
      { id: "P3", name: "三号位", x: 26, y: 62 },
      { id: "P4", name: "四号位", x: 70, y: 64 },
    ],
    nodes: [
      // 已签收节目段 S1：两发已燃并确认，留在原时刻
      { id: "N1", segmentId: "S1", positionId: "P1", batchId: "B1", plannedMs: 10000, actualMs: 10200, result: "fired", confirmedBy: "王磊", confirmedAt: "2026-09-25T21:46:00" },
      { id: "N2", segmentId: "S1", positionId: "P2", batchId: "B2", plannedMs: 14000, actualMs: 14300, result: "fired", confirmedBy: "王磊", confirmedAt: "2026-09-25T21:47:30" },
      // S2：一发哑弹已确认进待处置区，一发待登记
      { id: "N3", segmentId: "S2", positionId: "P3", batchId: "B3", plannedMs: 42000, actualMs: 42400, result: "dud", confirmedBy: "王磊", confirmedAt: "2026-09-25T21:55:00" },
      { id: "N4", segmentId: "S2", positionId: "P4", batchId: "B4", plannedMs: 55000, actualMs: null, result: "pending", confirmedBy: null, confirmedAt: null },
      // S3：同一号位两发计划仅差 0.6s，补录实际时刻后触发 1.2s 冷却判定
      { id: "N5", segmentId: "S3", positionId: "P1", batchId: "B1", plannedMs: 88000, actualMs: null, result: "pending", confirmedBy: null, confirmedAt: null },
      { id: "N6", segmentId: "S3", positionId: "P1", batchId: "B1", plannedMs: 88600, actualMs: null, result: "pending", confirmedBy: null, confirmedAt: null },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function loadState(): ShowState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ShowState;
      if (
        parsed &&
        Array.isArray(parsed.nodes) &&
        Array.isArray(parsed.batches) &&
        Array.isArray(parsed.segments)
      ) {
        return parsed;
      }
    }
  } catch {
    // 数据损坏时回落到预置数据
  }
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}

export function saveState(state: ShowState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, updatedAt: new Date().toISOString() })
    );
  } catch {
    // 隐私模式等场景写入失败时，页面内数据仍可用
  }
}

export function resetState(): ShowState {
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}
