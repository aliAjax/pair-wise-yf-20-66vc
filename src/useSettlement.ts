// 业务文件三：页面交互
// 唯一持有结算状态的 React Hook：节点登记、安全员确认、节目段签收、
// 结算校验（冷却不够即停下）与本地持久化全部从这里发出动作。

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canSignSegment,
  evaluateCooldown,
  parseTime,
  settle,
  type FiringResult,
  type SettlementState,
} from "./settlement";
import { clearState, loadState, saveState } from "./storage";

export function useSettlement() {
  const [state, setState] = useState<SettlementState>(() => loadState());

  useEffect(() => {
    saveState(state);
  }, [state]);

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<SettlementState["nodes"][number]>) => {
      setState((current) => {
        const target = current.nodes.find((node) => node.id === nodeId);
        if (!target) return current;
        const segment = current.segments.find((item) => item.id === target.segmentId);
        // 已签收节目段留在原时刻：节点一律锁死。
        if (segment?.signed) return current;
        // 安全员确认后的节点不允许再改动登记内容（需先撤回确认）。
        if (target.safetyConfirmed && !("safetyConfirmed" in patch)) return current;
        return {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === nodeId ? { ...node, ...patch } : node,
          ),
        };
      });
    },
    [],
  );

  /** 补录实际时刻：格式非法时拒绝写入。 */
  const setActualTime = useCallback(
    (nodeId: string, text: string) => {
      if (text !== "" && parseTime(text) === null) return;
      updateNode(nodeId, { actualTime: text });
    },
    [updateNode],
  );

  const setResult = useCallback(
    (nodeId: string, result: FiringResult) => {
      // 哑弹进待处置区、已燃释放占用；改结果时未确认才允许。
      updateNode(nodeId, { result });
    },
    [updateNode],
  );

  /** 未确认节点改挂弹药批次（占用随节点转移）。 */
  const patchBatch = useCallback(
    (nodeId: string, batchId: string) => {
      updateNode(nodeId, { batchId });
    },
    [updateNode],
  );

  const toggleConfirmed = useCallback(
    (nodeId: string) => {
      setState((current) => {
        const target = current.nodes.find((node) => node.id === nodeId);
        if (!target) return current;
        const segment = current.segments.find((item) => item.id === target.segmentId);
        if (segment?.signed) return current;
        // 确认前必须已补录实际时刻并登记结果。
        if (!target.safetyConfirmed) {
          if (parseTime(target.actualTime) === null) return current;
          if (target.result !== "fired" && target.result !== "dud") return current;
        }
        return {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === nodeId ? { ...node, safetyConfirmed: !node.safetyConfirmed } : node,
          ),
        };
      });
    },
    [],
  );

  const signSegment = useCallback((segmentId: string) => {
    setState((current) => {
      if (!canSignSegment(current, segmentId)) return current;
      // 签收前最后做一次全局冷却判定；冷却不够则不签收，保持可编辑。
      if (evaluateCooldown(current)) return current;
      return {
        ...current,
        segments: current.segments.map((segment) =>
          segment.id === segmentId ? { ...segment, signed: true } : segment,
        ),
      };
    });
  }, []);

  /** 结算台主按钮：跑到第一个冷却不足的节点即停下，并给出相邻节点。 */
  const runSettlement = useCallback(() => evaluateCooldown(state), [state]);

  const resetAll = useCallback(() => {
    setState(clearState());
  }, []);

  const report = useMemo(() => settle(state), [state]);

  return {
    state,
    report,
    setActualTime,
    setResult,
    patchBatch,
    toggleConfirmed,
    signSegment,
    runSettlement,
    resetAll,
  };
}
