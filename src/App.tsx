import { useMemo, useState } from "react";
import "./styles.css";
import {
  canSignSegment,
  formatTime,
  nodeEffectiveTime,
  parseTime,
  COOLDOWN_MS,
  type CooldownViolation,
} from "./settlement";
import { useSettlement } from "./useSettlement";

type CheckResult = { kind: "stop"; violation: CooldownViolation } | { kind: "pass" } | null;

const RESULT_META: Record<string, { label: string; className: string }> = {
  fired: { label: "已燃", className: "tag-fired" },
  dud: { label: "哑弹", className: "tag-dud" },
  "": { label: "未登记", className: "tag-none" },
};

function nodeCode(seq: number): string {
  return `N${String(seq).padStart(2, "0")}`;
}

function App() {
  const {
    state,
    report,
    setActualTime,
    setResult,
    patchBatch,
    toggleConfirmed,
    signSegment,
    runSettlement,
    resetAll,
  } = useSettlement();
  const [check, setCheck] = useState<CheckResult>(null);

  const batchMap = useMemo(
    () => new Map(state.batches.map((batch) => [batch.id, batch])),
    [state.batches],
  );
  const segmentMap = useMemo(
    () => new Map(state.segments.map((segment) => [segment.id, segment])),
    [state.segments],
  );

  const orderedNodes = useMemo(
    () => [...state.nodes].sort((a, b) => a.seq - b.seq),
    [state.nodes],
  );
  const points = useMemo(
    () => Array.from(new Set(orderedNodes.map((node) => node.point))),
    [orderedNodes],
  );

  // 时间轴量程：计划与实际时刻一并纳入，补录漂移不会溢出刻度。
  const axisRange = useMemo(() => {
    const all = orderedNodes.flatMap((node) =>
      [parseTime(node.plannedTime), parseTime(node.actualTime)].filter(
        (value): value is number => value !== null,
      ),
    );
    return { min: Math.min(...all), max: Math.max(...all) };
  }, [orderedNodes]);

  const positionPct = (ms: number): number =>
    ((ms - axisRange.min) / (axisRange.max - axisRange.min)) * 100;

  const handleRun = () => {
    const violation = runSettlement();
    setCheck(violation ? { kind: "stop", violation } : { kind: "pass" });
  };

  const stopNodeId = check?.kind === "stop" ? check.violation.node.id : null;

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62008 · 散场结算 · Port 62008</p>
        <h1>烟花燃放结算台</h1>
        <span>
          散场后逐节点登记批次、计划时刻与实际结果，由安全员确认：哑弹进入待处置区，已燃弹体才释放批次占用。
          补录实际时刻后执行结算判定，后续未确认节点须满足同点位 {formatTime(COOLDOWN_MS)} 冷却；
          冷却不够即停下并指出相邻节点，已签收节目段始终留在原时刻。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>节目段签收</small>
          <strong>
            {state.segments.filter((segment) => segment.signed).length}/{state.segments.length}
          </strong>
        </article>
        <article>
          <small>安全员确认节点</small>
          <strong>
            {report.confirmedCount}/{state.nodes.length}
          </strong>
        </article>
        <article>
          <small>批次消耗（已燃）</small>
          <strong>{report.totalConsumed}</strong>
        </article>
        <article>
          <small>待处置哑弹</small>
          <strong className="metric-warn">{report.totalDuds}</strong>
        </article>
        <article>
          <small>下一场可再用</small>
          <strong className="metric-ok">{report.totalReusable}</strong>
        </article>
      </section>

      <section className="panel settlement-bar">
        <div>
          <h2>结算判定</h2>
          <p>按脚本顺序核对所有「未确认」节点的同点位冷却；遇到第一处不足即停止。</p>
        </div>
        <div className="settlement-actions">
          <button className="primary" onClick={handleRun}>
            执行结算判定
          </button>
          <button onClick={resetAll}>清空并恢复预置场次</button>
        </div>
      </section>

      {check?.kind === "stop" && (
        <section className="banner banner-stop">
          <strong>
            ⛔ 结算在 {nodeCode(check.violation.node.seq)}（{check.violation.node.point}）停下
          </strong>
          <span>
            补录时刻 {check.violation.actualLabel} 与相邻节点 {nodeCode(check.violation.neighbor.seq)}
            （{check.violation.neighbor.point}，
            {check.violation.neighbor.actualTime || check.violation.neighbor.plannedTime}）
            同点位实际间隔 {(check.violation.gapMs / 1000).toFixed(3)} 秒，不足{" "}
            {(check.violation.requiredMs / 1000).toFixed(3)} 秒冷却。
            请先调整该节点；已签收节目段留在原时刻，不会被移动。
          </span>
        </section>
      )}
      {check?.kind === "pass" && (
        <section className="banner banner-pass">
          <strong>✅ 冷却校验通过</strong>
          <span>
            所有未确认节点与同点位相邻节点的实际间隔均不低于 {formatTime(COOLDOWN_MS)}，
            可继续安全员确认与节目段签收。
          </span>
        </section>
      )}

      <section className="panel">
        <div className="heading">
          <div>
            <p>节目段签收</p>
            <h2>三段节目</h2>
          </div>
          <span className="hint">签收后整段锁定在原时刻，节点不可再改</span>
        </div>
        <div className="segment-grid">
          {state.segments.map((segment) => {
            const nodes = orderedNodes.filter((node) => node.segmentId === segment.id);
            const signable = canSignSegment(state, segment.id);
            const blockedByCooldown = signable && report.violation !== null;
            return (
              <article key={segment.id} className={segment.signed ? "segment signed" : "segment"}>
                <div className="segment-head">
                  <h3>{segment.name}</h3>
                  {segment.signed && <span className="tag tag-signed">已签收</span>}
                </div>
                <p className="cue">音乐时间点：{segment.musicCue}</p>
                <ul className="segment-nodes">
                  {nodes.map((node) => (
                    <li key={node.id}>
                      {nodeCode(node.seq)} · {node.point}
                      <span className={`tag ${RESULT_META[node.result].className}`}>
                        {RESULT_META[node.result].label}
                      </span>
                      {node.safetyConfirmed && <span className="tag tag-confirmed">已确认</span>}
                    </li>
                  ))}
                </ul>
                {segment.signed ? (
                  <p className="locked">
                    🔒 签收锁定原时刻，自{" "}
                    {nodes[0] ? formatTime(nodeEffectiveTime(nodes[0])) : "--:--.---"} 起
                  </p>
                ) : (
                  <div className="segment-actions">
                    <button
                      className="primary"
                      disabled={!signable || blockedByCooldown}
                      onClick={() => signSegment(segment.id)}
                    >
                      签收本段
                    </button>
                    {!signable && (
                      <small className="hint">需段内节点全部补录结果并经安全员确认</small>
                    )}
                    {blockedByCooldown && (
                      <small className="hint warn-text">存在冷却不足节点，先执行结算判定</small>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="workspace workspace-wide">
        <section className="panel registry">
          <div className="heading">
            <div>
              <p>发射节点登记</p>
              <h2>六个节点</h2>
            </div>
          </div>
          <div className="node-list">
            {orderedNodes.map((node) => {
              const segment = segmentMap.get(node.segmentId);
              const locked = segment?.signed ?? false;
              const isStop = stopNodeId === node.id;
              return (
                <article key={node.id} className={isStop ? "node-card node-stop" : "node-card"}>
                  <header>
                    <b>{nodeCode(node.seq)}</b>
                    <div className="node-title">
                      <h3>{node.point}</h3>
                      <p>{segment?.name}</p>
                    </div>
                    {locked ? (
                      <span className="tag tag-signed">段已签收</span>
                    ) : (
                      node.safetyConfirmed && <span className="tag tag-confirmed">已确认</span>
                    )}
                    {isStop && <span className="tag tag-stop">冷却不足</span>}
                  </header>

                  <div className="node-grid">
                    <label>
                      <span>登记批次</span>
                      <select
                        value={node.batchId}
                        disabled={locked || node.safetyConfirmed}
                        onChange={(event) => patchBatch(node.id, event.target.value)}
                      >
                        {state.batches.map((batch) => (
                          <option key={batch.id} value={batch.id}>
                            {batch.label}（{batch.spec}）
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>计划时刻</span>
                      <input value={node.plannedTime} disabled />
                    </label>
                    <label>
                      <span>补录实际时刻（mm:ss.SSS）</span>
                      <input
                        value={node.actualTime}
                        placeholder="00:00.000"
                        disabled={locked || node.safetyConfirmed}
                        onChange={(event) => setActualTime(node.id, event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="node-footer">
                    <div className="result-switch">
                      {(["fired", "dud", ""] as const).map((value) => (
                        <button
                          key={value || "none"}
                          className={
                            node.result === value ? `switch-on ${RESULT_META[value].className}` : ""
                          }
                          disabled={locked || node.safetyConfirmed}
                          onClick={() => setResult(node.id, value)}
                        >
                          {value === "fired" ? "已燃" : value === "dud" ? "哑弹" : "未登记"}
                        </button>
                      ))}
                    </div>
                    <button
                      className={node.safetyConfirmed ? "confirmed" : ""}
                      disabled={locked}
                      onClick={() => toggleConfirmed(node.id)}
                    >
                      {locked
                        ? "🔒 已随段签收"
                        : node.safetyConfirmed
                          ? "✓ 安全员已确认（撤回）"
                          : "安全员确认"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="side">
          <section className="panel">
            <div className="heading">
              <div>
                <p>批次台账</p>
                <h2>四批弹药</h2>
              </div>
            </div>
            <table className="ledger">
              <thead>
                <tr>
                  <th>批次 / 口径</th>
                  <th>入库</th>
                  <th>已燃</th>
                  <th>待处置</th>
                  <th>再用</th>
                </tr>
              </thead>
              <tbody>
                {report.accounts.map((account) => (
                  <tr key={account.batch.id}>
                    <td>
                      <strong>{account.batch.label}</strong>
                      <small>占用 {account.allocated} 发</small>
                    </td>
                    <td>{account.batch.total}</td>
                    <td className="num-fired">{account.consumed}</td>
                    <td className="num-dud">{account.pendingDuds}</td>
                    <td className="num-reuse">{account.reusable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">已燃弹体释放批次占用；哑弹留在待处置区，不计入下一场可再用。</p>
          </section>

          <section className="panel dud-panel">
            <div className="heading">
              <div>
                <p>哑弹待处置区</p>
                <h2>{report.totalDuds} 发待处置</h2>
              </div>
            </div>
            {report.dudNodes.length === 0 ? (
              <p className="hint">暂无哑弹。</p>
            ) : (
              <ul className="dud-list">
                {report.dudNodes.map((node) => (
                  <li key={node.id}>
                    <b>{nodeCode(node.seq)}</b>
                    <span>
                      {node.point} · {batchMap.get(node.batchId)?.label}
                      <small>{node.actualTime || "未补录时刻"}</small>
                    </span>
                    <span className={`tag ${node.safetyConfirmed ? "tag-confirmed" : "tag-dud"}`}>
                      {node.safetyConfirmed ? "已确认待处置" : "待安全员确认"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>同一份记录</p>
            <h2>实际时间轴</h2>
          </div>
          <span className="hint">灰线刻度为计划时刻，色点为补录实际时刻（未补录沿用计划时刻）</span>
        </div>
        <div className="timeline">
          {points.map((point) => (
            <div key={point} className="lane">
              <div className="lane-label">{point}</div>
              <div className="lane-track">
                <span className="axis-start">{formatTime(axisRange.min)}</span>
                <span className="axis-end">{formatTime(axisRange.max)}</span>
                {orderedNodes
                  .filter((node) => node.point === point)
                  .map((node) => {
                    const planned = parseTime(node.plannedTime);
                    const actual = parseTime(node.actualTime);
                    const effective = nodeEffectiveTime(node);
                    const isStop = stopNodeId === node.id;
                    return (
                      <div
                        key={node.id}
                        className="marker-wrap"
                        style={{ left: `${positionPct(effective)}%` }}
                      >
                        {planned !== null && actual !== null && (
                          <span
                            className="planned-tick"
                            style={{
                              left: `${positionPct(planned) - positionPct(effective)}%`,
                            }}
                          />
                        )}
                        <span
                          className={[
                            "marker",
                            node.result === "fired" ? "marker-fired" : "",
                            node.result === "dud" ? "marker-dud" : "",
                            node.result === "" ? "marker-none" : "",
                            isStop ? "marker-stop" : "",
                          ].join(" ")}
                          title={`${nodeCode(node.seq)} 计划 ${node.plannedTime} / 实际 ${node.actualTime || "未补录"}`}
                        >
                          {node.safetyConfirmed && "✓"}
                        </span>
                        <small>
                          {nodeCode(node.seq)} {node.actualTime || node.plannedTime}
                        </small>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
        <div className="legend">
          <span><i className="dot marker-fired" /> 已燃</span>
          <span><i className="dot marker-dud" /> 哑弹</span>
          <span><i className="dot marker-none" /> 未登记</span>
          <span><i className="dot marker-stop" /> 冷却不足被拦下</span>
          <span><i className="tick-legend" /> 计划时刻</span>
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>同一份记录</p>
            <h2>燃放点位平面图</h2>
          </div>
        </div>
        <div className="site-map">
          <div className="stage-band">舞台 / 音乐控制位</div>
          <div className="point-grid">
            {points.map((point) => {
              const nodes = orderedNodes.filter((node) => node.point === point);
              return (
                <article key={point} className="point-zone">
                  <h3>{point}</h3>
                  <ul>
                    {nodes.map((node) => (
                      <li key={node.id} className={stopNodeId === node.id ? "li-stop" : ""}>
                        <b>{nodeCode(node.seq)}</b>
                        <span>{batchMap.get(node.batchId)?.label}</span>
                        <span className={`tag ${RESULT_META[node.result].className}`}>
                          {RESULT_META[node.result].label}
                        </span>
                        <small>{node.actualTime || node.plannedTime}</small>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          <div className="audience-band">观众区 / 安全距离警戒线</div>
        </div>
      </section>
    </main>
  );
}

export default App;
