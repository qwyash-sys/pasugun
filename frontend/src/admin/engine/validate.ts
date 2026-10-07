// 룰 설정 입력 검증. backend/app/rule_config.py의 validate_config와 같은 규칙(범위 + 값 사이 순서)이다.
// 서버가 있으면 서버가 최종 판단하지만, 데모(서버 없음)와 입력 즉시 안내를 위해 화면에서도 같은 검사를 한다.
import type { OrderRule, ParamSpec, RuleConfig, RulesState } from "../api/types";

export interface ValidationResult {
  /** 입력칸 아래에 바로 보여줄 오류(경로 → 메시지). 경로는 global.키 또는 rules.룰.params.키. */
  byPath: Record<string, string>;
  /** 저장 거부 시 한 번에 보여줄 전체 오류 목록. */
  list: string[];
}

export const fmtNum = (v: number): string => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4))));

function pathOf(section: "global" | string, key: string): string {
  return section === "global" ? `global.${key}` : `rules.${section}.params.${key}`;
}

export function validateConfig(cfg: RuleConfig, state: Pick<RulesState, "rules" | "global_params" | "schema">): ValidationResult {
  const byPath: Record<string, string> = {};
  const list: string[] = [];
  const add = (path: string, prefix: string, message: string) => {
    byPath[path] = message;
    list.push(`${prefix}${message}`);
  };

  const specsOf = new Map<string, Map<string, ParamSpec>>();
  specsOf.set("global", new Map(state.global_params.map((p) => [p.key, p])));
  for (const r of state.rules) specsOf.set(r.name, new Map(r.params.map((p) => [p.key, p])));

  const checkSection = (section: string, values: Record<string, number>, prefix: string) => {
    for (const [key, spec] of specsOf.get(section) ?? []) {
      const v = values[key];
      if (typeof v !== "number" || Number.isNaN(v)) add(pathOf(section, key), prefix, `${spec.label}: 숫자를 입력해주세요.`);
      else if (v < spec.min || v > spec.max) add(pathOf(section, key), prefix, `${spec.label}: ${fmtNum(spec.min)}~${fmtNum(spec.max)}${spec.unit} 범위여야 해요.`);
    }
  };
  checkSection("global", cfg.global, "전역 · ");
  for (const r of state.rules) checkSection(r.name, cfg.rules[r.name]?.params ?? {}, `${r.rule_id} · `);

  const checkOrder = (section: string, orders: OrderRule[], values: Record<string, number>, prefix: string) => {
    const specs = specsOf.get(section);
    if (!specs) return;
    for (const [small, big, equalOk] of orders) {
      const a = values[small];
      const b = values[big];
      if (byPath[pathOf(section, small)] || byPath[pathOf(section, big)]) continue; // 범위 오류가 먼저
      if (typeof a !== "number" || typeof b !== "number") continue;
      if (equalOk ? a > b : a >= b) {
        add(
          pathOf(section, big),
          prefix,
          `${specs.get(small)!.label}(${fmtNum(a)})은(는) ${specs.get(big)!.label}(${fmtNum(b)})보다 ${equalOk ? "크지 않아야" : "작아야"} 해요.`,
        );
      }
    }
  };
  const order = state.schema?.order;
  if (order) {
    checkOrder("global", order.global, cfg.global, "전역 · ");
    for (const r of state.rules) checkOrder(r.name, order.rules[r.name] ?? [], cfg.rules[r.name]?.params ?? {}, `${r.rule_id} · `);
  }
  return { byPath, list };
}
