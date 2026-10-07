// 룰 하나(또는 전역 판정 기준)의 조건·임계값을 고치는 오른쪽 패널. 입력 즉시 검증하고, 저장 전에 과거 거래에 미치는 영향을 보여준다.
import { useMemo, useState } from "react";
import { ConfigError, getAdminApi } from "../../api";
import type { ParamSpec, RuleConfig, RuleInfo, RulesState } from "../../api/types";
import { backtest } from "../../engine/backtest";
import { cloneConfig, diffConfig, showValue } from "../../engine/configDiff";
import { fmtNum, validateConfig } from "../../engine/validate";
import type { AnalysisData } from "../../data";
import { RESPONSE_SOURCE } from "../../../config";
import { Badge, Drawer, Field } from "../../components/ui";
import { ImpactTable } from "./ImpactTable";

export type EditTarget = { kind: "rule"; rule: RuleInfo } | { kind: "global" };

const GLOBAL_GROUPS: { title: string; keys: string[] }[] = [
  { title: "1단계 · 송금위험도 등급", keys: ["account_mid", "account_high"] },
  { title: "2단계 · AI분석 등급", keys: ["context_mid", "context_high"] },
  { title: "2단계 · 유사 사기사례(RAG) 점수", keys: ["rag_mid_sim", "rag_mid_score", "rag_high_sim", "rag_high_score"] },
  { title: "AI 질문 개입 기준(송금위험도 점수)", keys: ["intervene_question", "intervene_safety"] },
];

function pathOf(target: EditTarget, key: string): string {
  return target.kind === "global" ? `global.${key}` : `rules.${target.rule.name}.params.${key}`;
}

export default function RuleEditor({
  target,
  state,
  data,
  onClose,
  onSaved,
  notify,
}: {
  target: EditTarget;
  state: RulesState;
  data: AnalysisData | null;
  onClose: () => void;
  onSaved: (s: RulesState) => void;
  notify: (text: string, tone?: "green" | "danger") => void;
}) {
  const defaultOf = (key: string): number => (target.kind === "global" ? state.defaults.global[key] : state.defaults.rules[target.rule.name].params[key]);
  const specs: ParamSpec[] = target.kind === "global" ? state.global_params : target.rule.params;
  const current = target.kind === "global" ? state.config.global : state.config.rules[target.rule.name].params;
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(specs.map((p) => [p.key, fmtNum(current[p.key])])));
  const [enabled, setEnabled] = useState(target.kind === "rule" ? state.config.rules[target.rule.name].enabled : true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const draft: RuleConfig = useMemo(() => {
    const next = cloneConfig(state.config);
    const values = target.kind === "global" ? next.global : next.rules[target.rule.name].params;
    for (const p of specs) values[p.key] = text[p.key].trim() === "" ? NaN : Number(text[p.key]);
    if (target.kind === "rule") next.rules[target.rule.name].enabled = enabled;
    return next;
  }, [text, enabled, state.config, specs, target]);

  const check = useMemo(() => validateConfig(draft, state), [draft, state]);
  const changes = useMemo(() => diffConfig(state.config, draft, state), [draft, state]);
  const impact = useMemo(() => {
    if (!data || check.list.length || !changes.length) return null;
    const labeled = data.logs.filter((l) => data.truthOf(l));
    return backtest(labeled, state.config, draft, data.corpus, data.truthOf);
  }, [data, check.list.length, changes.length, draft, state.config]);

  const save = async () => {
    setBusy(true);
    setServerErrors([]);
    try {
      const res = await getAdminApi().putRules(draft, note.trim());
      notify(`저장했어요 — ${res.changes.length}개 항목이 바뀌었어요.`);
      onSaved(res.state);
      onClose();
    } catch (e) {
      if (e instanceof ConfigError) setServerErrors(e.errors);
      else notify(e instanceof Error ? e.message : "저장하지 못했어요.", "danger");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setText(Object.fromEntries(specs.map((p) => [p.key, fmtNum(defaultOf(p.key))])));
    if (target.kind === "rule") setEnabled(state.defaults.rules[target.rule.name].enabled);
  };

  const renderField = (p: ParamSpec) => {
    const path = pathOf(target, p.key);
    const defaultValue = defaultOf(p.key);
    return (
      <Field key={p.key} label={`${p.label}${p.unit ? ` (${p.unit})` : ""}`} hint={`${p.help ? p.help + " · " : ""}범위 ${fmtNum(p.min)}~${fmtNum(p.max)} · 기본 ${fmtNum(defaultValue)}`} error={check.byPath[path]}>
        <input type="number" inputMode="decimal" step={p.step} min={p.min} max={p.max} value={text[p.key]} onChange={(e) => setText({ ...text, [p.key]: e.target.value })} aria-invalid={!!check.byPath[path]} />
      </Field>
    );
  };

  const title = target.kind === "global" ? "전체 판정 기준" : `${target.rule.rule_id} ${target.rule.label}`;
  const canSave = !busy && changes.length > 0 && check.list.length === 0;

  return (
    <Drawer
      open
      wide
      title={title}
      sub={target.kind === "global" ? "송금위험도·AI분석 등급 경계와 질문 개입 기준이에요." : target.rule.definition}
      onClose={onClose}
      footer={
        <>
          <button className="c-btn" onClick={reset} disabled={busy}>
            기본값으로 되돌리기
          </button>
          <button className="c-btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="c-btn c-btn-primary" onClick={save} disabled={!canSave}>
            {busy ? "저장 중…" : "저장하고 적용"}
          </button>
        </>
      }
    >
      <div className="c-stack">
        {target.kind === "rule" && (
          <div className="c-note">
            <strong>조건</strong> {target.rule.condition}
            <br />
            <strong>기본 배점</strong> {target.rule.scoring}
          </div>
        )}

        {target.kind === "rule" && (
          <label className="c-switch">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            이 룰 사용 {enabled ? "" : <Badge tone="warn">중지 — 점수가 0점으로 계산돼요</Badge>}
          </label>
        )}

        {target.kind === "global" ? (
          GLOBAL_GROUPS.map((g) => (
            <section key={g.title} className="c-edit-group">
              <h3>{g.title}</h3>
              <div className="c-edit-grid">{specs.filter((p) => g.keys.includes(p.key)).map(renderField)}</div>
            </section>
          ))
        ) : (
          <section className="c-edit-group">
            <h3>조건·배점</h3>
            <div className="c-edit-grid">{specs.map(renderField)}</div>
          </section>
        )}

        <Field label="변경 사유(이력에 남아요)">
          <input type="text" value={note} maxLength={120} placeholder="예: 신규계좌 사기 급증으로 배점 상향" onChange={(e) => setNote(e.target.value)} />
        </Field>

        <section className="c-edit-group">
          <h3>저장하면 이렇게 바뀌어요</h3>
          {changes.length === 0 ? (
            <p className="c-muted c-small">아직 바꾼 값이 없어요.</p>
          ) : (
            <ul className="c-change-list">
              {changes.map((c) => (
                <li key={c.path}>
                  <span>{c.label}</span>
                  <b>
                    {showValue(c.from)} → {showValue(c.to)}
                  </b>
                </li>
              ))}
            </ul>
          )}
          {check.list.length > 0 && (
            <div className="c-note tone-danger" role="alert">
              저장하려면 먼저 아래 항목을 고쳐주세요.
              <ul>
                {check.list.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {serverErrors.length > 0 && (
            <div className="c-note tone-danger" role="alert">
              서버가 저장을 거절했어요.
              <ul>
                {serverErrors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {impact && <ImpactTable result={impact} />}
          {!data && changes.length > 0 && check.list.length === 0 && <p className="c-muted c-small">영향 미리보기를 계산하는 중…</p>}
        </section>

        <p className="c-muted c-small">
          {RESPONSE_SOURCE === "demo"
            ? "데모 모드: 설정은 이 브라우저에 저장되고 통계·모의 계산에 반영돼요. 고객 화면 데모는 미리 정해진 결과를 보여줘요."
            : "저장하면 이후 모든 고객의 송금 판정에 바로 적용돼요. 이미 끝난 거래의 판정은 바뀌지 않아요."}
        </p>
      </div>
    </Drawer>
  );
}
