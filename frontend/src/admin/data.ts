// 룰 관리·통계 분석 화면이 함께 쓰는 분석용 데이터 묶음(로그 + 사기 사례 말뭉치 + 모니터링 사례 → 정답 라벨).
import { getAdminApi } from "./api";
import type { CaseItem, Scenario, TransferLog } from "./api/types";
import { makeTruthOf } from "./engine/backtest";
import { toRows, type Row } from "./engine/stats";

export interface AnalysisData {
  logs: TransferLog[];
  scenarios: Scenario[];
  corpus: Map<string, Scenario>;
  cases: CaseItem[];
  truthOf: (log: TransferLog) => "fraud" | "normal" | null;
  rows: Row[];
}

export async function loadAnalysisData(): Promise<AnalysisData> {
  const api = getAdminApi();
  const [logs, scenarios, cases] = await Promise.all([api.getLogs(), api.getScenarios(), api.listCases()]);
  const truthOf = makeTruthOf(cases);
  return { logs, scenarios, corpus: new Map(scenarios.map((s) => [s.id, s])), cases, truthOf, rows: toRows(logs, truthOf) };
}
