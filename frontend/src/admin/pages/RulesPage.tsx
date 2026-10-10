import { useMemo, useState } from "react";
import { RULE_CATALOG } from "../../components/signalMeta";
import { getAdminApi } from "../api";
import type { ConfigHistoryEntry, RuleInfo, RulesState } from "../api/types";
import { loadAnalysisData } from "../data";
import { ruleStats } from "../engine/stats";
import { getByPath, setByPath, showValue } from "../engine/configDiff";
import { ConfigError } from "../api";
import { fmtNum } from "../engine/validate";
import { fmtShort } from "../format";
import { Badge, Card, ErrorBox, Kpi, Loading, Modal, PageHeader, Segmented, useLoad, useToast } from "../components/ui";
import AiAnalysis from "./rules/AiAnalysis";
import RuleEditor, { type EditTarget } from "./rules/RuleEditor";

const GLOBAL_LABELS: [string, string][] = [
  ["account_mid", "송금위험도 '중' 시작"],
  ["account_high", "송금위험도 '고' 시작"],
  ["context_mid", "AI분석 '중' 시작"],
  ["context_high", "AI분석 '고' 시작"],
  ["intervene_question", "공감 질문 개입 시작"],
  ["intervene_safety", "안전 질문 개입 시작"],
];

function paramChips(rule: RuleInfo, state: RulesState): string[] {
  const values = state.config.rules[rule.name].params;
  return rule.params.map((p) => `${p.label} ${fmtNum(values[p.key])}${p.unit}`);
}

export default function RulesPage() {
  const rules = useLoad<RulesState>(() => getAdminApi().getRules(), []);
  const history = useLoad<ConfigHistoryEntry[]>(() => getAdminApi().getRuleHistory(), []);
  const data = useLoad(loadAnalysisData, []);
  const [override, setOverride] = useState<RulesState | null>(null);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"rules" | "ai" | "history">("rules");
  const [revert, setRevert] = useState<ConfigHistoryEntry | null>(null);
  const { show, node } = useToast();

  const state = override ?? rules.data;
  const stats = useMemo(() => (state && data.data ? new Map(ruleStats(data.data.rows, state.rules.map((r) => r.name)).map((s) => [s.signal, s])) : null), [state, data.data]);

  if (rules.loading && !state) return <Page><Loading /></Page>;
  if (rules.error || !state) return <Page><ErrorBox message={rules.error ?? "룰 설정을 불러오지 못했어요."} onRetry={() => void rules.reload()} /></Page>;

  const applied = (s: RulesState) => {
    setOverride(s);
    void history.reload(true);
  };

  const doReset = async () => {
    try {
      applied(await getAdminApi().resetRules());
      show("기본값(SPEC)으로 복원했어요.");
    } catch (e) {
      show(e instanceof Error ? e.message : "복원하지 못했어요.", "danger");
    }
    setConfirmReset(false);
  };

  /** 이력 한 건을 되돌린다: 그 변경의 '바뀐 값'이 지금도 그대로인 항목만 '이전 값'으로 돌린다(이후에 또 바뀐 항목은 건드리지 않음). */
  const revertPlan = (h: ConfigHistoryEntry) => {
    const apply = h.changes.filter((c) => getByPath(state.config, c.path) === c.to);
    const skipped = h.changes.length - apply.length;
    let cfg = state.config;
    for (const c of apply) cfg = setByPath(cfg, c.path, c.from);
    return { apply, skipped, cfg };
  };

  const doRevert = async () => {
    if (!revert) return;
    const plan = revertPlan(revert);
    try {
      const res = await getAdminApi().putRules(plan.cfg, `${revert.id} 되돌리기`);
      applied(res.state);
      show(`${revert.id} 변경을 되돌렸어요 (${res.changes.length}개 항목).`);
    } catch (e) {
      show(e instanceof ConfigError ? e.errors[0] : e instanceof Error ? e.message : "되돌리지 못했어요.", "danger");
    }
    setRevert(null);
  };

  const planned = RULE_CATALOG.filter((r) => !r.signal);
  const activeCount = state.rules.filter((r) => r.enabled).length;
  const last = history.data?.[0];
  const customized = history.data && history.data.length > 0;

  return (
    <Page>
      <PageHeader
        title="룰 관리"
        sub="송금위험도(1단계) 룰의 조건·점수와 전체 판정 기준을 확인하고 조정해요. 저장하면 변경 이력이 남아요."
        actions={
          <>
            <button className="c-btn" onClick={() => setTarget({ kind: "global" })}>
              전체 판정 기준 조정
            </button>
            <button className="c-btn" onClick={() => setConfirmReset(true)} disabled={!customized}>
              기본값으로 복원
            </button>
          </>
        }
      />

      <div className="c-kpis c-kpis-4">
        <Kpi label="사용 중인 룰" value={`${activeCount} / ${state.rules.length}`} sub={`준비 중 ${planned.length}개 별도`} tone="green" />
        <Kpi label="설정 버전" value={`v${state.version}`} sub={last ? `${fmtShort(last.at)} · ${last.actor}` : "기본값 그대로"} />
        <Kpi label="송금위험도 등급" value={`${state.config.global.account_mid} · ${state.config.global.account_high}`} sub="중 · 고 시작 점수" />
        <Kpi label="AI분석 등급" value={`${state.config.global.context_mid} · ${state.config.global.context_high}`} sub="중 · 고 시작 점수" />
      </div>

      <div className="c-tabs">
        <Segmented
          label="룰 관리 보기"
          value={tab}
          onChange={setTab}
          options={[
            { id: "rules", label: "룰·판정 기준" },
            { id: "ai", label: "✨ AI 룰 분석" },
            { id: "history", label: "변경 이력", count: history.data?.length ?? 0 },
          ]}
        />
      </div>

      <div className="c-stack" hidden={tab !== "rules"}>
        <Card title="1단계 · 송금위험도 룰" sub="행을 누르면 조건·배점을 고칠 수 있어요. 발동 통계는 쌓인 거래 로그 기준이에요.">
          <div className="c-table-wrap">
            <table className="c-table c-rules">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>룰</th>
                  <th>현재 설정</th>
                  <th className="num">최대 점수</th>
                  <th className="num" title="사기 거래 중 발동한 비율 / 정상 거래 중 발동한 비율">
                    발동률 사기 / 정상
                  </th>
                  <th>상태</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.rules.map((r) => {
                  const st = stats?.get(r.name);
                  const isOpen = open === r.name;
                  return (
                    <RuleRows key={r.name} rule={r} state={state} stat={st} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : r.name)} onEdit={() => setTarget({ kind: "rule", rule: r })} />
                  );
                })}
                {planned.map((r) => (
                  <tr key={r.id} className="c-planned">
                    <td>
                      <b>{r.id}</b>
                    </td>
                    <td>
                      <div className="c-rule-name">{r.name}</div>
                      <div className="c-muted c-small">{r.definition}</div>
                    </td>
                    <td className="c-muted c-small">{r.condition}</td>
                    <td className="num c-muted">-</td>
                    <td className="num c-muted">-</td>
                    <td>
                      <Badge tone="muted">준비 중</Badge>
                    </td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="전체 판정 기준" sub="룰 점수를 합산한 뒤 등급을 가르는 경계값이에요." actions={<button className="c-btn c-btn-sm" onClick={() => setTarget({ kind: "global" })}>조정</button>}>
          <div className="c-global">
            {GLOBAL_LABELS.map(([key, label]) => {
              const changed = state.config.global[key] !== state.defaults.global[key];
              return (
                <div key={key} className={changed ? "changed" : ""}>
                  <span>{label}</span>
                  <strong>{fmtNum(state.config.global[key])}점</strong>
                  {changed && <small>기본 {fmtNum(state.defaults.global[key])}</small>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="c-stack" hidden={tab !== "ai"}>
        {data.data ? (
          <AiAnalysis state={state} data={data.data} onApplied={applied} notify={show} />
        ) : data.error ? (
          <Card title="AI 룰 분석">
            <ErrorBox message={data.error} onRetry={() => void data.reload()} />
          </Card>
        ) : (
          <Card title="AI 룰 분석">
            <Loading text="분석에 쓸 거래 로그를 불러오는 중…" />
          </Card>
        )}
      </div>

      <div className="c-stack" hidden={tab !== "history"}>
        <Card title="변경 이력" sub="누가 언제 무엇을 바꿨는지 남아요. 되돌리려면 ‘룰·판정 기준’ 탭에서 값을 다시 고치거나 기본값으로 복원하세요.">
          {history.data && history.data.length > 0 ? (
            <ul className="c-history">
              {history.data.map((h) => (
                <li key={h.id}>
                  <div className="c-history-head">
                    <b>{h.id}</b>
                    <span className="c-muted c-small">
                      {fmtShort(h.at)} · {h.actor}
                    </span>
                    {revertPlan(h).apply.length > 0 && (
                      <button className="c-btn c-btn-sm" onClick={() => setRevert(h)}>
                        이 변경 되돌리기
                      </button>
                    )}
                  </div>
                  <p>{h.summary}</p>
                  {h.note && <p className="c-muted c-small">사유: {h.note}</p>}
                  {h.changes.length > 1 && (
                    <ul className="c-change-list">
                      {h.changes.map((c) => (
                        <li key={c.path}>
                          <span>{c.label}</span>
                          <b>
                            {showValue(c.from)} → {showValue(c.to)}
                          </b>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="c-muted">아직 바꾼 적이 없어요. 기본값(SPEC)을 쓰고 있어요.</p>
          )}
        </Card>
      </div>

      {target && (
        <RuleEditor key={target.kind === "rule" ? target.rule.name : "global"} target={target} state={state} data={data.data} onClose={() => setTarget(null)} onSaved={applied} notify={show} />
      )}

      <Modal
        open={!!revert}
        title={revert ? `${revert.id} 변경을 되돌릴까요?` : ""}
        onClose={() => setRevert(null)}
        footer={
          <>
            <button className="c-btn" onClick={() => setRevert(null)}>
              취소
            </button>
            <button className="c-btn c-btn-primary" onClick={() => void doRevert()}>
              되돌리기
            </button>
          </>
        }
      >
        {revert && (
          <>
            <ul className="c-change-list">
              {revertPlan(revert).apply.map((c) => (
                <li key={c.path}>
                  <span>{c.label}</span>
                  <b>
                    {showValue(c.to)} → {showValue(c.from)}
                  </b>
                </li>
              ))}
            </ul>
            {revertPlan(revert).skipped > 0 && <p className="c-muted c-small">그 뒤에 다시 바뀐 {revertPlan(revert).skipped}개 항목은 그대로 둬요.</p>}
            <p className="c-muted c-small">되돌리기도 새 변경 이력으로 남아요.</p>
          </>
        )}
      </Modal>

      <Modal
        open={confirmReset}
        title="기본값으로 복원할까요?"
        onClose={() => setConfirmReset(false)}
        footer={
          <>
            <button className="c-btn" onClick={() => setConfirmReset(false)}>
              취소
            </button>
            <button className="c-btn c-btn-danger" onClick={() => void doReset()}>
              복원
            </button>
          </>
        }
      >
        <p className="c-muted">모든 룰의 조건·점수와 전체 판정 기준이 SPEC 기본값으로 돌아가요. 이 복원도 변경 이력에 남아요.</p>
      </Modal>
      {node}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="console-content">{children}</div>;
}

function RuleRows({ rule, state, stat, isOpen, onToggle, onEdit }: { rule: RuleInfo; state: RulesState; stat?: { fraudRate: number; normalRate: number; hitFraud: number; hitNormal: number }; isOpen: boolean; onToggle: () => void; onEdit: () => void }) {
  const chips = paramChips(rule, state);
  const defaults = state.defaults.rules[rule.name];
  const changed = JSON.stringify(defaults) !== JSON.stringify(state.config.rules[rule.name]);
  return (
    <>
      <tr className={`clickable ${isOpen ? "selected" : ""} ${rule.enabled ? "" : "c-off"}`} onClick={onToggle}>
        <td>
          <b>{rule.rule_id}</b>
        </td>
        <td>
          <div className="c-rule-name">{rule.label}</div>
          <div className="c-muted c-small">{rule.definition}</div>
        </td>
        <td>
          <div className="c-chips">
            {chips.slice(0, 3).map((c) => (
              <span key={c}>{c}</span>
            ))}
            {chips.length > 3 && <span className="more">+{chips.length - 3}</span>}
          </div>
        </td>
        <td className="num">
          <b>{rule.max_score}</b>점
        </td>
        <td className="num">{stat ? `${Math.round(stat.fraudRate * 100)}% / ${Math.round(stat.normalRate * 100)}%` : "…"}</td>
        <td>
          {rule.enabled ? <Badge tone="green">사용</Badge> : <Badge tone="warn">중지</Badge>} {changed && <Badge tone="blue">조정됨</Badge>}
        </td>
        <td className="num">
          <button
            className="c-btn c-btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            조정
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="c-rule-detail">
          <td />
          <td colSpan={6}>
            <dl className="c-kv">
              <dt>무엇을 보나요</dt>
              <dd>{rule.definition}</dd>
              <dt>조건</dt>
              <dd>{rule.condition}</dd>
              <dt>기본 배점</dt>
              <dd>{rule.scoring}</dd>
              <dt>현재 설정</dt>
              <dd>{chips.join(" · ")}</dd>
              {stat && (
                <>
                  <dt>발동 실적</dt>
                  <dd>
                    사기 거래에서 {stat.hitFraud}건, 정상 거래에서 {stat.hitNormal}건 발동했어요.
                  </dd>
                </>
              )}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
