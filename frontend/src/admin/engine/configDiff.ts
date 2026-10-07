// 두 룰 설정의 차이를 항목별로 뽑는다(변경 이력·영향 미리보기·AI 제안의 '무엇을 바꾸나'에 쓴다).
import type { ConfigChange, RuleConfig, RulesState } from "../api/types";
import { fmtNum } from "./validate";

export function cloneConfig(cfg: RuleConfig): RuleConfig {
  return structuredClone(cfg);
}

export function diffConfig(oldCfg: RuleConfig, newCfg: RuleConfig, state: Pick<RulesState, "rules" | "global_params">): ConfigChange[] {
  const changes: ConfigChange[] = [];
  for (const spec of state.global_params) {
    const a = oldCfg.global[spec.key];
    const b = newCfg.global[spec.key];
    if (a !== b) changes.push({ path: `global.${spec.key}`, label: `전역 · ${spec.label}`, from: a, to: b });
  }
  for (const rule of state.rules) {
    const a = oldCfg.rules[rule.name];
    const b = newCfg.rules[rule.name];
    if (!a || !b) continue;
    if (a.enabled !== b.enabled) changes.push({ path: `rules.${rule.name}.enabled`, label: `${rule.rule_id} ${rule.label} · 사용 여부`, from: a.enabled, to: b.enabled });
    for (const spec of rule.params) {
      if (a.params[spec.key] !== b.params[spec.key]) {
        changes.push({ path: `rules.${rule.name}.params.${spec.key}`, label: `${rule.rule_id} ${rule.label} · ${spec.label}`, from: a.params[spec.key], to: b.params[spec.key] });
      }
    }
  }
  return changes;
}

export const showValue = (v: number | boolean): string => (typeof v === "boolean" ? (v ? "사용" : "중지") : fmtNum(v));

export function summarize(changes: ConfigChange[]): string {
  if (!changes.length) return "변경 없음";
  const first = changes[0];
  return `${first.label}: ${showValue(first.from)} → ${showValue(first.to)}${changes.length > 1 ? ` 외 ${changes.length - 1}건` : ""}`;
}

/** 경로("rules.amount_anomaly.params.ratio_high")로 설정 값을 읽고/쓴다. */
export function setByPath(cfg: RuleConfig, path: string, value: number | boolean): RuleConfig {
  const next = cloneConfig(cfg);
  const parts = path.split(".");
  if (parts[0] === "global") next.global[parts[1]] = value as number;
  else if (parts[3] === undefined) next.rules[parts[1]].enabled = value as boolean;
  else next.rules[parts[1]].params[parts[3]] = value as number;
  return next;
}

export function getByPath(cfg: RuleConfig, path: string): number | boolean | undefined {
  const parts = path.split(".");
  if (parts[0] === "global") return cfg.global[parts[1]];
  if (parts[2] === "enabled") return cfg.rules[parts[1]]?.enabled;
  return cfg.rules[parts[1]]?.params[parts[3]];
}
