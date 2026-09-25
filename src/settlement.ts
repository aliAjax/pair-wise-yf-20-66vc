// 业务文件一：结算判定
// 负责时间解析、节目段签收、同点位 1.2 秒冷却校验，以及批次消耗汇总。
// 纯函数，不接触 React 与 localStorage，便于单独核对规则。

export type FiringResult = "fired" | "dud" | "";

export interface ProgramSegment {
  id: string;
  name: string;
  musicCue: string; // 音乐时间点
  signed: boolean; // 安全员已签收：锁定在原时刻
}

export interface FiringNode {
  id: string;
  seq: number; // 脚本顺序（即计划时间轴顺序）
  point: string; // 点位编号
  batchId: string;
  segmentId: string;
  plannedTime: string; // mm:ss.SSS
  actualTime: string; // 补录的实际时刻，空串表示未补录
  result: FiringResult;
  safetyConfirmed: boolean; // 安全员确认
}

export interface AmmoBatch {
  id: string;
  label: string; // 型号
  spec: string; // 口径
  total: number; // 入库数量
  reusableFloor?: number; // 未使用可再用数量是否单独扣减（本工具按总数直接结算）
}

export interface SettlementState {
  segments: ProgramSegment[];
  batches: AmmoBatch[];
  nodes: FiringNode[];
}

export interface BatchAccount {
  batch: AmmoBatch;
  allocated: number; // 已登记占用（所有绑定该批次的节点）
  consumed: number; // 已燃弹体：释放占用
  pendingDuds: number; // 哑弹：进入待处置区，仍占用批次
  reusable: number; // 下一场可再用
}

export interface CooldownViolation {
  node: FiringNode; // 冷却不够而被拦下的节点
  neighbor: FiringNode; // 相邻的同点位节点
  gapMs: number;
  requiredMs: number;
  actualLabel: string;
}

export interface SettlementReport {
  accounts: BatchAccount[];
  violation: CooldownViolation | null;
  stopAtNodeId: string | null;
  totalConsumed: number;
  totalDuds: number;
  totalReusable: number;
  confirmedCount: number;
  dudNodes: FiringNode[];
}

export const COOLDOWN_MS = 1200;

/** mm:ss.SSS -> 毫秒；解析失败返回 null（静默拒绝非法输入）。 */
export function parseTime(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\.(\d{1,3})$/.exec(text.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3].padEnd(3, "0");
  if (seconds >= 60) return null;
  return minutes * 60_000 + seconds * 1000 + Number(fraction);
}

export function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const fraction = ms % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(3, "0")}`;
}

export function segmentNodeIds(state: SettlementState, segmentId: string): FiringNode[] {
  return state.nodes
    .filter((node) => node.segmentId === segmentId)
    .sort((a, b) => a.seq - b.seq);
}

/** 节目段可签收：段内每个节点都已补录实际时刻、登记结果且经安全员确认。 */
export function canSignSegment(state: SettlementState, segmentId: string): boolean {
  const nodes = segmentNodeIds(state, segmentId);
  if (nodes.length === 0) return false;
  return nodes.every(
    (node) =>
      parseTime(node.actualTime) !== null &&
      (node.result === "fired" || node.result === "dud") &&
      node.safetyConfirmed,
  );
}

/**
 * 同点位冷却结算：
 * 按脚本顺序依次处理；对每个「尚未安全员确认」的节点，与同点位紧邻的前一个
 * 已补录实际时刻的节点比较，间隔不足 1.2 秒即停下，返回相邻节点。
 * 已签收节目段中的节点不会出现在待处理序列里，保持在原时刻。
 */
export function evaluateCooldown(state: SettlementState): CooldownViolation | null {
  const ordered = [...state.nodes].sort((a, b) => a.seq - b.seq);
  // 每个点位保留最近一个已补录实际时刻的节点（签收段或已确认节点都作为参照）。
  const lastByPoint = new Map<string, FiringNode>();

  for (const node of ordered) {
    const segment = state.segments.find((item) => item.id === node.segmentId);
    const locked = segment?.signed ?? false;

    if (!node.safetyConfirmed && !locked) {
      const actual = parseTime(node.actualTime);
      const neighbor = lastByPoint.get(node.point);
      if (actual !== null && neighbor) {
        const neighborTime = parseTime(neighbor.actualTime);
        if (neighborTime !== null) {
          const gap = actual - neighborTime;
          if (gap < COOLDOWN_MS) {
            return {
              node,
              neighbor,
              gapMs: gap,
              requiredMs: COOLDOWN_MS,
              actualLabel: node.actualTime,
            };
          }
        }
      }
    }

    if (parseTime(node.actualTime) !== null) {
      lastByPoint.set(node.point, node);
    }
  }
  return null;
}

/** 汇总每个批次的占用 / 消耗 / 待处置 / 下一场可再用。 */
export function summarizeBatches(state: SettlementState): BatchAccount[] {
  return state.batches.map((batch) => {
    const linked = state.nodes.filter((node) => node.batchId === batch.id);
    const consumed = linked.filter((node) => node.result === "fired").length;
    const pendingDuds = linked.filter((node) => node.result === "dud").length;
    const allocated = linked.length;
    // 已燃才释放占用；哑弹仍在待处置区。未登记节点的弹药原样回到下一场。
    const reusable = batch.total - consumed - pendingDuds;
    return { batch, allocated, consumed, pendingDuds, reusable };
  });
}

export function settle(state: SettlementState): SettlementReport {
  const accounts = summarizeBatches(state);
  const violation = evaluateCooldown(state);
  return {
    accounts,
    violation,
    stopAtNodeId: violation ? violation.node.id : null,
    totalConsumed: accounts.reduce((sum, item) => sum + item.consumed, 0),
    totalDuds: accounts.reduce((sum, item) => sum + item.pendingDuds, 0),
    totalReusable: accounts.reduce((sum, item) => sum + item.reusable, 0),
    confirmedCount: state.nodes.filter((node) => node.safetyConfirmed).length,
    dudNodes: state.nodes.filter((node) => node.result === "dud"),
  };
}

/** 节点实际时刻的显示文本：未补录时回退计划时刻（时间轴始终有刻度）。 */
export function nodeEffectiveTime(node: FiringNode): number {
  return parseTime(node.actualTime) ?? parseTime(node.plannedTime) ?? 0;
}
