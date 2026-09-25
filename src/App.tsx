/**
 * 业务文件三：页面交互
 * 节点登记、补录实际时刻、安全员确认、节目段签收、冷却报警处置，
 * 以及读取同一份记录的时间轴与点位图。
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  COOLDOWN_MS,
  NODE_STATUS_LABEL,
  confirmCheck,
  describeViolation,
  earliestAllowedMs,
  effectiveMs,
  evaluateCooldown,
  formatMs,
  nodeStatusKey,
  parseTimeInput,
  segmentSignable,
  summarize,
} from "./settlement";
import type { LaunchNode, NodeResult, ShowState } from "./settlement";
import { loadState, resetState, saveState } from "./storage";

/** 时刻录入框：失焦 / 回车时解析提交，非法输入标红并保留待改 */
function TimeField(props: {
  value: number | null;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (ms: number) => void;
}) {
  const { value, placeholder, disabled, onCommit } = props;
  const [text, setText] = useState(value === null ? "" : formatMs(value));
  const [error, setError] = useState(false);

  useEffect(() => {
    setText(value === null ? "" : formatMs(value));
    setError(false);
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setText(value === null ? "" : formatMs(value));
      setError(false);
      return;
    }
    const parsed = parseTimeInput(trimmed);
    if (parsed === null) {
      setError(true);
      return;
    }
    onCommit(parsed);
  };

  return (
    <input
      className={error ? "time-input error" : "time-input"}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      title={error ? "时刻格式无效，示例：01:28.5 或 88.5" : undefined}
      onChange={(e) => {
        setText(e.target.value);
        setError(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function App() {
  const [state, setState] = useState<ShowState>(() => loadState());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // 时间轴、点位图、登记台、汇总面板全部读取这同一份记录
  const violations = useMemo(() => evaluateCooldown(state), [state]);
  const summary = useMemo(() => summarize(state), [state]);
  const maxMs = useMemo(
    () => Math.max(100000, ...state.nodes.map((n) => effectiveMs(n))) + 10000,
    [state]
  );
  const ticks = useMemo(() => {
    const list: number[] = [];
    for (let t = 0; t <= maxMs; t += 20000) list.push(t);
    return list;
  }, [maxMs]);

  const update = (mutate: (draft: ShowState) => void) => {
    setState((prev) => {
      const draft = structuredClone(prev);
      mutate(draft);
      saveState(draft);
      return draft;
    });
  };

  const patchNode = (nodeId: string, patch: Partial<LaunchNode>) =>
    update((draft) => {
      const node = draft.nodes.find((n) => n.id === nodeId);
      if (node) Object.assign(node, patch);
    });

  const handleConfirm = (nodeId: string) => {
    const check = confirmCheck(state, nodeId, violations);
    if (!check.ok) return; // 冷却不够等原因：停下，不写入确认
    patchNode(nodeId, {
      confirmedBy: state.officer.trim() || "安全员",
      confirmedAt: new Date().toISOString(),
    });
  };

  const handleSignOff = (segmentId: string) => {
    if (!segmentSignable(state, segmentId)) return;
    update((draft) => {
      const seg = draft.segments.find((s) => s.id === segmentId);
      if (seg) seg.signedOff = true;
    });
  };

  const handleReset = () => {
    if (window.confirm("重置将清空浏览器中的结算记录并恢复预置数据，继续？")) {
      setSelectedNodeId(null);
      setState(resetState());
    }
  };

  const selectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    document.getElementById(`node-${nodeId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  const pct = (ms: number) => `${(ms / maxMs) * 100}%`;
  const segmentOf = (node: LaunchNode) =>
    state.segments.find((s) => s.id === node.segmentId);
  const clockOf = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "";

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62008 · 散场结算 · 数据仅保存在本机浏览器</p>
        <h1>燃放结算台</h1>
        <span>
          {state.showTitle}：预置三段节目、四批弹药、六个发射节点。逐发登记批次、计划时刻、实际结果与安全员确认；
          哑弹进待处置区，已燃弹体才释放批次占用；补录实际时刻后，同点位后续未确认节点须满足{" "}
          {(COOLDOWN_MS / 1000).toFixed(1)}s 冷却，不足即停下并指出相邻节点。
        </span>
        <div className="hero-actions">
          <label className="officer">
            <span>当班安全员</span>
            <input
              value={state.officer}
              onChange={(e) =>
                update((draft) => {
                  draft.officer = e.target.value;
                })
              }
            />
          </label>
          <button onClick={handleReset}>重置为预置数据</button>
          <small>更新于 {new Date(state.updatedAt).toLocaleString("zh-CN")}</small>
        </div>
      </section>

      {violations.length > 0 && (
        <section className="alarm">
          <h2>⚠ 同点位冷却不足，结算已停下</h2>
          <ul>
            {violations.map((v) => {
              const next = state.nodes.find((n) => n.id === v.nextId);
              const seg = next ? segmentOf(next) : undefined;
              const earliest = earliestAllowedMs(state, v.nextId, violations);
              return (
                <li key={`${v.anchorId}-${v.nextId}`}>
                  <span>{describeViolation(state, v)}</span>
                  {seg?.signedOff ? (
                    <em>节目段已签收，节点留在原时刻，请现场处置</em>
                  ) : next && next.actualMs === null && earliest !== null ? (
                    <button onClick={() => patchNode(v.nextId, { plannedMs: earliest })}>
                      顺延 {v.nextId} 至 {formatMs(earliest)}
                    </button>
                  ) : (
                    <em>请核对 {v.nextId} 的实际时刻</em>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="metrics">
        <article>
          <small>批次消耗（已燃）</small>
          <strong>{summary.totalConsumed}</strong>
        </article>
        <article>
          <small>待处置（哑弹）</small>
          <strong>{summary.totalDisposal}</strong>
        </article>
        <article>
          <small>占用中（未确认）</small>
          <strong>{summary.totalOccupied}</strong>
        </article>
        <article>
          <small>下一场可再用</small>
          <strong>{summary.totalReusable}</strong>
        </article>
        <article className={violations.length > 0 ? "metric-alert" : ""}>
          <small>冷却报警</small>
          <strong>{violations.length}</strong>
        </article>
      </section>

      <section className="workspace">
        <section className="panel register-panel">
          <div className="heading">
            <div>
              <p>逐发核对</p>
              <h2>发射节点登记台</h2>
            </div>
            <span className="caption">计划 / 实际时刻支持 01:28.5 或 88.5 格式</span>
          </div>
          <div className="table-scroll">
            <table className="node-table">
              <thead>
                <tr>
                  <th>节点</th>
                  <th>节目段</th>
                  <th>点位</th>
                  <th>批次</th>
                  <th>计划时刻</th>
                  <th>实际时刻（补录）</th>
                  <th>实际结果</th>
                  <th>安全员确认</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {state.nodes.map((node) => {
                  const segment = segmentOf(node);
                  const position = state.positions.find((p) => p.id === node.positionId);
                  const batch = state.batches.find((b) => b.id === node.batchId);
                  const locked = segment?.signedOff ?? false;
                  const check = confirmCheck(state, node.id, violations);
                  const status = nodeStatusKey(node, violations);
                  const earliest = earliestAllowedMs(state, node.id, violations);
                  const inViolation = violations.some(
                    (v) => v.anchorId === node.id || v.nextId === node.id
                  );
                  const rowClass = [
                    inViolation ? "row-alert" : "",
                    selectedNodeId === node.id ? "row-selected" : "",
                  ]
                    .join(" ")
                    .trim();
                  return (
                    <tr key={node.id} id={`node-${node.id}`} className={rowClass}>
                      <td>
                        <b>{node.id}</b>
                      </td>
                      <td>
                        {segment?.name}
                        {locked && <span className="lock">已签收 · 留在原时刻</span>}
                      </td>
                      <td>{position?.name}</td>
                      <td>
                        {batch?.id} · {batch?.model}
                      </td>
                      <td>
                        <TimeField
                          value={node.plannedMs}
                          disabled={locked}
                          onCommit={(ms) => patchNode(node.id, { plannedMs: ms })}
                        />
                      </td>
                      <td>
                        <TimeField
                          value={node.actualMs}
                          placeholder="补录"
                          disabled={locked}
                          onCommit={(ms) => patchNode(node.id, { actualMs: ms })}
                        />
                      </td>
                      <td>
                        <select
                          value={node.result}
                          disabled={locked}
                          onChange={(e) =>
                            patchNode(node.id, { result: e.target.value as NodeResult })
                          }
                        >
                          <option value="pending">待登记</option>
                          <option value="fired">已燃</option>
                          <option value="dud">哑弹</option>
                        </select>
                      </td>
                      <td>
                        {node.confirmedBy ? (
                          <div className="confirm-cell">
                            <span className="confirm-done">
                              ✓ {node.confirmedBy} {clockOf(node.confirmedAt)}
                            </span>
                            {!locked && (
                              <button
                                className="link"
                                onClick={() =>
                                  patchNode(node.id, { confirmedBy: null, confirmedAt: null })
                                }
                              >
                                撤销
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="confirm-cell">
                            <button
                              className="primary small"
                              disabled={!check.ok}
                              title={check.reason ?? "安全员确认"}
                              onClick={() => handleConfirm(node.id)}
                            >
                              确认
                            </button>
                            {check.reason && <small className="reason">{check.reason}</small>}
                            {earliest !== null &&
                              !locked &&
                              (node.actualMs === null ? (
                                <button
                                  className="link"
                                  onClick={() => patchNode(node.id, { plannedMs: earliest })}
                                >
                                  顺延至 {formatMs(earliest)}
                                </button>
                              ) : (
                                <small className="reason">与先燃节点过近，请核对实际时刻</small>
                              ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`pill st-${status}`}>{NODE_STATUS_LABEL[status]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="side">
          <section className="panel">
            <div className="heading">
              <div>
                <p>批次结算</p>
                <h2>四批弹药</h2>
              </div>
            </div>
            <table className="batch-table">
              <thead>
                <tr>
                  <th>批次</th>
                  <th>总量</th>
                  <th>消耗</th>
                  <th>待处置</th>
                  <th>占用</th>
                  <th>可再用</th>
                </tr>
              </thead>
              <tbody>
                {summary.perBatch.map(({ batch, consumed, disposal, occupied, reusable }) => (
                  <tr key={batch.id}>
                    <td>
                      <b>{batch.id}</b> {batch.model}
                      <small>
                        {batch.caliber} · 安全距离 {batch.distance}
                      </small>
                    </td>
                    <td>{batch.total}</td>
                    <td className="num-fired">{consumed}</td>
                    <td className="num-dud">{disposal}</td>
                    <td>{occupied}</td>
                    <td className="num-reuse">{reusable}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>合计</td>
                  <td>{summary.perBatch.reduce((s, b) => s + b.batch.total, 0)}</td>
                  <td className="num-fired">{summary.totalConsumed}</td>
                  <td className="num-dud">{summary.totalDisposal}</td>
                  <td>{summary.totalOccupied}</td>
                  <td className="num-reuse">{summary.totalReusable}</td>
                </tr>
              </tbody>
            </table>
            {summary.perBatch.map(({ batch, consumed, disposal, occupied, reusable }) => (
              <div className="batch-bar" key={batch.id} title={`${batch.id} ${batch.model}`}>
                <i className="seg-fired" style={{ width: `${(consumed / batch.total) * 100}%` }} />
                <i className="seg-dud" style={{ width: `${(disposal / batch.total) * 100}%` }} />
                <i className="seg-occ" style={{ width: `${(occupied / batch.total) * 100}%` }} />
                <i className="seg-reuse" style={{ width: `${(reusable / batch.total) * 100}%` }} />
                <span>{batch.id}</span>
              </div>
            ))}
            <div className="bar-legend">
              <span>
                <i className="seg-fired" /> 已燃消耗
              </span>
              <span>
                <i className="seg-dud" /> 待处置
              </span>
              <span>
                <i className="seg-occ" /> 占用中
              </span>
              <span>
                <i className="seg-reuse" /> 可再用
              </span>
            </div>
          </section>

          <section className="panel">
            <div className="heading">
              <div>
                <p>待处置区</p>
                <h2>哑弹 {summary.totalDisposal} 发</h2>
              </div>
            </div>
            {summary.disposalNodes.length === 0 ? (
              <p className="empty">暂无哑弹进入待处置区</p>
            ) : (
              <ul className="disposal-list">
                {summary.disposalNodes.map((n) => {
                  const batch = state.batches.find((b) => b.id === n.batchId);
                  const pos = state.positions.find((p) => p.id === n.positionId);
                  return (
                    <li key={n.id}>
                      <b>{n.id}</b> {batch?.model}（{batch?.caliber}）· {pos?.name} · 实际{" "}
                      {n.actualMs !== null ? formatMs(n.actualMs) : "--"} · 安全员 {n.confirmedBy}{" "}
                      确认，隔离待转运
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="heading">
              <div>
                <p>节目段签收</p>
                <h2>三段节目</h2>
              </div>
            </div>
            <div className="segment-list">
              {state.segments.map((seg) => {
                const nodes = state.nodes.filter((n) => n.segmentId === seg.id);
                const confirmed = nodes.filter((n) => n.confirmedBy !== null).length;
                const signable = segmentSignable(state, seg.id);
                return (
                  <article key={seg.id} className="segment-card">
                    <div>
                      <h3>{seg.name}</h3>
                      <p>
                        {confirmed}/{nodes.length} 节点已确认
                      </p>
                    </div>
                    {seg.signedOff ? (
                      <span className="pill signed">已签收 · 留在原时刻</span>
                    ) : (
                      <button
                        disabled={!signable}
                        title={signable ? "签收节目段" : "全部节点确认后可签收"}
                        onClick={() => handleSignOff(seg.id)}
                      >
                        签收
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </aside>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>时间轴</p>
            <h2>燃放时刻对照</h2>
          </div>
          <span className="caption">与点位图读取同一份节点记录 · 空心刻度为计划时刻</span>
        </div>
        <div className="timeline">
          {state.segments.map((seg) => (
            <div className="tl-lane" key={seg.id}>
              <div className="tl-lane-label">
                {seg.name}
                {seg.signedOff && <em>已签收</em>}
              </div>
              <div className="tl-track">
                {ticks.map((t) => (
                  <i key={t} className="tl-tick" style={{ left: pct(t) }} />
                ))}
                {state.nodes
                  .filter((n) => n.segmentId === seg.id)
                  .map((n) => {
                    const status = nodeStatusKey(n, violations);
                    const eff = effectiveMs(n);
                    return (
                      <Fragment key={n.id}>
                        {n.actualMs !== null && n.actualMs !== n.plannedMs && (
                          <Fragment>
                            <i
                              className="tl-planned"
                              style={{ left: pct(n.plannedMs) }}
                              title={`计划 ${formatMs(n.plannedMs)}`}
                            />
                            <i
                              className="tl-drift"
                              style={{
                                left: pct(Math.min(n.plannedMs, n.actualMs)),
                                width: pct(Math.abs(n.actualMs - n.plannedMs)),
                              }}
                            />
                          </Fragment>
                        )}
                        <button
                          className={`tl-node st-${status}${
                            selectedNodeId === n.id ? " selected" : ""
                          }`}
                          style={{ left: pct(eff) }}
                          title={`${n.id} · ${n.actualMs !== null ? "实际" : "计划"} ${formatMs(
                            eff
                          )} · ${NODE_STATUS_LABEL[status]}`}
                          onClick={() => selectNode(n.id)}
                        >
                          {n.id}
                        </button>
                      </Fragment>
                    );
                  })}
              </div>
            </div>
          ))}
          <div className="tl-axis">
            {ticks.map((t) => (
              <span key={t} style={{ left: pct(t) }}>
                {formatMs(t)}
              </span>
            ))}
          </div>
        </div>
        <div className="legend">
          {(["pending", "registered", "fired", "dud", "blocked"] as const).map((k) => (
            <span key={k}>
              <i className={`dot st-${k}`} /> {NODE_STATUS_LABEL[k]}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>点位平面图</p>
            <h2>发射场布置</h2>
          </div>
          <span className="caption">数据同源：{state.nodes.length} 个发射节点</span>
        </div>
        <div className="field-map">
          <div className="safety-line">
            <span>安全距离线 · 观众区在警戒线外</span>
          </div>
          {state.positions.map((pos) => {
            const nodes = state.nodes.filter((n) => n.positionId === pos.id);
            const alert = violations.some((v) => v.positionId === pos.id);
            return (
              <div
                key={pos.id}
                className={alert ? "pos pos-alert" : "pos"}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <b>{pos.name}</b>
                <div className="pos-nodes">
                  {nodes.map((n) => {
                    const status = nodeStatusKey(n, violations);
                    return (
                      <button
                        key={n.id}
                        className={`chip st-${status}`}
                        title={`${n.id} · ${formatMs(effectiveMs(n))} · ${NODE_STATUS_LABEL[status]}`}
                        onClick={() => selectNode(n.id)}
                      >
                        {n.id} {formatMs(effectiveMs(n))}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

export default App;
