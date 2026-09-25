/**
 * 业务文件一：结算判定
 * 节点状态推导、同点位 1.2 秒冷却判定、批次消耗 / 待处置 / 可再用汇总、时刻解析。
 * 全部为纯函数，不触碰 DOM 与 localStorage。
 */

export const COOLDOWN_MS = 1200; // 同点位一点二秒冷却

export type NodeResult = "pending" | "fired" | "dud";

export interface Segment {
  id: string;
  name: string;
  signedOff: boolean; // 已签收节目段留在原时刻
}

export interface Batch {
  id: string;
  model: string;
  caliber: string;
  total: number;
  distance: string; // 安全距离
}

export interface Position {
  id: string;
  name: string;
  x: number; // 点位图百分比坐标
  y: number;
}

export interface LaunchNode {
  id: string;
  segmentId: string;
  positionId: string;
  batchId: string;
  plannedMs: number; // 计划时刻（毫秒，自开场起）
  actualMs: number | null; // 补录的实际时刻
  result: NodeResult; // 实际结果
  confirmedBy: string | null; // 安全员确认
  confirmedAt: string | null;
}

export interface ShowState {
  showTitle: string;
  officer: string; // 当班安全员
  segments: Segment[];
  batches: Batch[];
  positions: Position[];
  nodes: LaunchNode[];
  updatedAt: string;
}

/** 节点当前生效时刻：已补录实际时刻优先，否则按计划时刻 */
export function effectiveMs(node: LaunchNode): number {
  return node.actualMs ?? node.plannedMs;
}

export interface CooldownViolation {
  positionId: string;
  anchorId: string; // 先燃节点（已补录实际时刻）
  nextId: string; // 相邻的后续未确认节点
  gapMs: number;
}

/**
 * 同点位冷却判定：补录实际时刻后，该点位后续未确认节点
 * 与先燃节点的间隔必须 ≥ 1.2s，否则给出相邻节点对。
 */
export function evaluateCooldown(state: ShowState): CooldownViolation[] {
  const violations: CooldownViolation[] = [];
  for (const pos of state.positions) {
    const chain = state.nodes
      .filter((n) => n.positionId === pos.id)
      .slice()
      .sort((a, b) => effectiveMs(a) - effectiveMs(b) || a.id.localeCompare(b.id));
    chain.forEach((anchor, i) => {
      if (anchor.actualMs === null) return; // 只以已补录实际时刻的节点为锚
      for (let j = i + 1; j < chain.length; j += 1) {
        const next = chain[j];
        if (next.confirmedBy !== null) continue; // 已确认节点不在管控范围
        const gapMs = effectiveMs(next) - anchor.actualMs;
        if (gapMs < COOLDOWN_MS) {
          violations.push({ positionId: pos.id, anchorId: anchor.id, nextId: next.id, gapMs });
        }
      }
    });
  }
  return violations;
}

/** 把一条冷却违规写成可读的相邻节点提示 */
export function describeViolation(state: ShowState, v: CooldownViolation): string {
  const pos = state.positions.find((p) => p.id === v.positionId);
  const anchor = state.nodes.find((n) => n.id === v.anchorId);
  const next = state.nodes.find((n) => n.id === v.nextId);
  if (!anchor || !next) return "";
  const gap = (v.gapMs / 1000).toFixed(1);
  return `点位 ${pos?.name ?? v.positionId}：${anchor.id}（实际 ${formatMs(
    anchor.actualMs ?? 0
  )}）与相邻节点 ${next.id}（${formatMs(effectiveMs(next))}）间隔 ${gap}s，不足 ${(
    COOLDOWN_MS / 1000
  ).toFixed(1)}s 冷却`;
}

/** 节点作为“后续未确认节点”被拦下时，给出最早可放时刻 */
export function earliestAllowedMs(
  state: ShowState,
  nodeId: string,
  violations: CooldownViolation[]
): number | null {
  const related = violations.filter((v) => v.nextId === nodeId);
  if (related.length === 0) return null;
  let earliest = 0;
  for (const v of related) {
    const anchor = state.nodes.find((n) => n.id === v.anchorId);
    if (anchor && anchor.actualMs !== null) {
      earliest = Math.max(earliest, anchor.actualMs + COOLDOWN_MS);
    }
  }
  return earliest;
}

export interface ConfirmCheck {
  ok: boolean;
  reason: string | null;
}

/** 安全员确认前置判定：结果、实际时刻、同点位冷却缺一不可 */
export function confirmCheck(
  state: ShowState,
  nodeId: string,
  violations: CooldownViolation[]
): ConfirmCheck {
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, reason: "节点不存在" };
  if (node.confirmedBy) return { ok: false, reason: "已确认" };
  const segment = state.segments.find((s) => s.id === node.segmentId);
  if (segment?.signedOff) return { ok: false, reason: "节目段已签收" };
  if (node.result === "pending") return { ok: false, reason: "先登记实际结果" };
  if (node.actualMs === null) return { ok: false, reason: "先补录实际时刻" };
  const block = violations.find((v) => v.nextId === nodeId);
  if (block) {
    return {
      ok: false,
      reason: `冷却不足：与相邻节点 ${block.anchorId} 间隔 ${(block.gapMs / 1000).toFixed(1)}s（需 ≥${(
        COOLDOWN_MS / 1000
      ).toFixed(1)}s）`,
    };
  }
  return { ok: true, reason: null };
}

export type NodeStatusKey = "pending" | "registered" | "fired" | "dud" | "blocked";

export function nodeStatusKey(node: LaunchNode, violations: CooldownViolation[]): NodeStatusKey {
  if (node.confirmedBy) return node.result === "dud" ? "dud" : "fired";
  if (violations.some((v) => v.nextId === node.id)) return "blocked";
  if (node.result !== "pending") return "registered";
  return "pending";
}

export const NODE_STATUS_LABEL: Record<NodeStatusKey, string> = {
  pending: "待登记",
  registered: "待安全员确认",
  fired: "已燃 · 已结算",
  dud: "哑弹 · 待处置",
  blocked: "冷却锁定",
};

export interface BatchSummary {
  batch: Batch;
  consumed: number; // 批次消耗：已确认已燃
  disposal: number; // 待处置：已确认哑弹
  occupied: number; // 占用中：未确认节点
  reusable: number; // 下一场可再用
}

export interface SettlementSummary {
  perBatch: BatchSummary[];
  totalConsumed: number;
  totalDisposal: number;
  totalOccupied: number;
  totalReusable: number;
  disposalNodes: LaunchNode[];
}

/** 批次结算：哑弹进待处置区，已燃弹体才释放批次占用，未确认节点继续占用 */
export function summarize(state: ShowState): SettlementSummary {
  const perBatch = state.batches.map((batch) => {
    const nodes = state.nodes.filter((n) => n.batchId === batch.id);
    const consumed = nodes.filter((n) => n.confirmedBy !== null && n.result === "fired").length;
    const disposal = nodes.filter((n) => n.confirmedBy !== null && n.result === "dud").length;
    const occupied = nodes.length - consumed - disposal;
    const reusable = batch.total - consumed - disposal - occupied;
    return { batch, consumed, disposal, occupied, reusable };
  });
  return {
    perBatch,
    totalConsumed: perBatch.reduce((s, b) => s + b.consumed, 0),
    totalDisposal: perBatch.reduce((s, b) => s + b.disposal, 0),
    totalOccupied: perBatch.reduce((s, b) => s + b.occupied, 0),
    totalReusable: perBatch.reduce((s, b) => s + b.reusable, 0),
    disposalNodes: state.nodes.filter((n) => n.confirmedBy !== null && n.result === "dud"),
  };
}

/** 节目段签收：全部节点经安全员确认后可签收，签收后节点留在原时刻 */
export function segmentSignable(state: ShowState, segmentId: string): boolean {
  const nodes = state.nodes.filter((n) => n.segmentId === segmentId);
  return nodes.length > 0 && nodes.every((n) => n.confirmedBy !== null);
}

/** 毫秒 → mm:ss.t */
export function formatMs(ms: number): string {
  const tenths = Math.round(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const t = tenths % 10;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
}

/** 解析 "01:28.5" / "1:28.5" / "88.5" / "88" → 毫秒；非法输入返回 null */
export function parseTimeInput(raw: string): number | null {
  const text = raw.trim().replace("。", ".");
  if (!text) return null;
  const match = text.match(/^(?:(\d{1,3}):)?(\d{1,3})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const minutes = match[1] ? parseInt(match[1], 10) : 0;
  const seconds = parseInt(match[2], 10);
  if (match[1] && seconds >= 60) return null; // 有冒号时秒位须 < 60
  const frac = match[3] ? parseInt(match[3].padEnd(3, "0").slice(0, 3), 10) : 0;
  return minutes * 60000 + seconds * 1000 + frac;
}
