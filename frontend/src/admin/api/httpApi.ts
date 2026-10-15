import { API_BASE_URL } from "../../config";
import type { AdminApi, NarrativeResult, ReanalyzeResult } from "./adminApi";
import { ConfigError } from "./adminApi";
import type { Branch, CaseDoc, CaseItem, ConfigChange, ConfigHistoryEntry, ReportPayload, RagCandidate, RagEvalCase, RuleConfig, RulesState, Scenario, ScenarioHistoryEntry, ScenarioInput, ScenarioSaveResult, TransferLog } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* 본문 없음 */
    }
    const errors = (detail as { errors?: string[] } | null)?.errors;
    if (res.status === 422 && Array.isArray(errors)) throw new ConfigError(errors);
    throw new Error(typeof detail === "string" ? detail : `요청 실패(${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** 로컬 백엔드(FastAPI)에 붙는 구현. 룰 설정은 서버에 저장되고 실제 점수 계산에 즉시 반영된다. */
export class HttpAdminApi implements AdminApi {
  readonly mode = "local" as const;

  getRules() {
    return call<RulesState>("/api/admin/rules");
  }

  async putRules(config: RuleConfig, note = "") {
    const res = await call<RulesState & { changes: ConfigChange[] }>("/api/admin/rules/config", { method: "PUT", body: JSON.stringify({ config, note }) });
    const { changes, ...state } = res;
    return { state: state as RulesState, changes };
  }

  async resetRules() {
    const { changes: _changes, ...state } = await call<RulesState & { changes: ConfigChange[] }>("/api/admin/rules/reset", { method: "POST" });
    void _changes;
    return state as RulesState;
  }

  getRuleHistory() {
    return call<ConfigHistoryEntry[]>("/api/admin/rules/history");
  }

  getLogs() {
    return call<TransferLog[]>("/api/admin/logs");
  }

  getScenarios() {
    return call<Scenario[]>("/api/admin/scenarios");
  }

  saveScenario(id: string | null, scenario: ScenarioInput, note = "") {
    const body = JSON.stringify({ scenario, note });
    return id
      ? call<ScenarioSaveResult>(`/api/admin/scenarios/${encodeURIComponent(id)}`, { method: "PUT", body })
      : call<ScenarioSaveResult>("/api/admin/scenarios", { method: "POST", body });
  }

  getScenarioHistory() {
    return call<ScenarioHistoryEntry[]>("/api/admin/scenarios/history");
  }

  async searchRag(text: string) {
    const res = await call<{ match: { candidates: RagCandidate[] } }>("/api/admin/rag/search", { method: "POST", body: JSON.stringify({ text }) });
    return res.match.candidates;
  }

  async evaluateRag() {
    const res = await call<{ items: RagEvalCase[] }>("/api/admin/rag/evaluate", { method: "POST" });
    return res.items.map(({ expected, text, candidates }) => ({ expected, text, candidates }));
  }

  listBranches() {
    return call<Branch[]>("/api/admin/branches");
  }

  listCases() {
    return call<CaseItem[]>("/api/admin/cases");
  }

  getCase(id: string) {
    return call<{ case: CaseDoc; report: ReportPayload }>(`/api/admin/cases/${encodeURIComponent(id)}`);
  }

  saveCase(doc: CaseDoc) {
    return call<CaseDoc>(`/api/admin/cases/${encodeURIComponent(doc.case_id)}`, { method: "PUT", body: JSON.stringify(doc) });
  }

  reanalyze(caseId: string) {
    return call<ReanalyzeResult>(`/api/admin/cases/${encodeURIComponent(caseId)}/reanalyze`, { method: "POST" });
  }

  narrate(task: string, facts: Record<string, unknown>, fallback: string) {
    return call<NarrativeResult>("/api/admin/ai/narrative", { method: "POST", body: JSON.stringify({ task, facts, fallback }) });
  }
}
