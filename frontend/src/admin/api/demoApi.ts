// 서버 없이(Vercel 데모·오프라인) 관리자 페이지를 쓰는 구현. 샘플 데이터는 실제 엔진으로 만든 시드이고,
// 사용자가 바꾼 설정·사례 처리 내용은 이 브라우저(localStorage)에만 저장된다 — 새로고침해도 유지되고 다른 사람과는 공유되지 않는다.
import { allDemoReports, toSummary } from "../../api/reports";
import type { AdminApi, NarrativeResult, ReanalyzeResult } from "./adminApi";
import { ConfigError } from "./adminApi";
import type {
  Branch, CaseChoice, CaseDoc, CaseItem, ConfigChange, ConfigHistoryEntry, ReportPayload, RuleConfig, RuleInfo, RulesState, Scenario, TransferLog,
} from "./types";
import { CURRENT_STAFF, createCase } from "../engine/cases";
import { kstIso } from "../format";
import { cloneConfig, diffConfig, summarize } from "../engine/configDiff";
import { analyzeActivity, makeActivity, seededRandom } from "../engine/postcheck";
import { validateConfig } from "../engine/validate";

const KEY = { rules: "pasugun.demo.rules.v1", cases: "pasugun.demo.cases.v1", reports: "pasugun.demo.reports.v1" };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback; // 저장소가 막혀 있어도(시크릿 창 등) 화면은 메모리 상태로 동작한다
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 실패는 무시 */
  }
}

interface RuleStore {
  config: RuleConfig;
  version: number;
  history: ConfigHistoryEntry[];
}

type Fixture = RulesState & { schema: NonNullable<RulesState["schema"]> };

let fixtureP: Promise<Fixture> | null = null;
const fixture = (): Promise<Fixture> => (fixtureP ??= import("../../demoData/admin/ruleSchema.json").then((m) => m.default as unknown as Fixture));
let casesP: Promise<CaseDoc[]> | null = null;
const seedCases = (): Promise<CaseDoc[]> => (casesP ??= import("../../demoData/admin/cases.json").then((m) => m.default as unknown as CaseDoc[]));
let branchesP: Promise<Branch[]> | null = null;
const branchList = (): Promise<Branch[]> => (branchesP ??= import("../../demoData/admin/branches.json").then((m) => m.default as unknown as Branch[]));

let ruleStore: RuleStore | null = null;
let caseOverrides: Record<string, CaseDoc> | null = null;
let extraReports: ReportPayload[] | null = null;

async function rules(): Promise<RuleStore> {
  if (!ruleStore) {
    const fx = await fixture();
    ruleStore = load<RuleStore>(KEY.rules, { config: cloneConfig(fx.defaults), version: 1, history: [] });
  }
  return ruleStore;
}

const maxScore = (rule: RuleInfo, cfg: RuleConfig): number => {
  const conf = cfg.rules[rule.name];
  if (!conf?.enabled) return 0;
  return Math.max(0, ...rule.params.filter((p) => p.kind === "score").map((p) => conf.params[p.key]));
};

async function rulesState(): Promise<RulesState> {
  const [fx, store] = await Promise.all([fixture(), rules()]);
  return {
    version: store.version,
    config: store.config,
    defaults: fx.defaults,
    global_params: fx.global_params,
    schema: fx.schema,
    rules: fx.rules.map((r) => ({ ...r, enabled: store.config.rules[r.name].enabled, max_score: maxScore(r, store.config) })),
  };
}

const overrides = (): Record<string, CaseDoc> => (caseOverrides ??= load<Record<string, CaseDoc>>(KEY.cases, {}));
const extras = (): ReportPayload[] => (extraReports ??= load<ReportPayload[]>(KEY.reports, []));

function findReport(id: string): ReportPayload | undefined {
  return extras().find((r) => r.report_id === id) ?? allDemoReports().find((r) => r.report_id === id);
}

async function allCases(): Promise<CaseDoc[]> {
  const base = await seedCases();
  const map = new Map<string, CaseDoc>(base.map((c) => [c.case_id, c]));
  for (const c of Object.values(overrides())) map.set(c.case_id, c);
  return [...map.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const nowKst = (): string => kstIso(new Date());

export class DemoAdminApi implements AdminApi {
  readonly mode = "demo" as const;

  getRules() {
    return rulesState();
  }

  async putRules(config: RuleConfig, note = "") {
    const state = await rulesState();
    const check = validateConfig(config, state);
    if (check.list.length) throw new ConfigError(check.list);
    const store = await rules();
    const changes = diffConfig(store.config, config, state);
    if (changes.length) {
      store.config = cloneConfig(config);
      store.version += 1;
      store.history = [...store.history, { id: `CFG-${String(store.version).padStart(4, "0")}`, version: store.version, at: nowKst(), actor: CURRENT_STAFF.name, note, summary: summarize(changes), changes }];
      save(KEY.rules, store);
    }
    return { state: await rulesState(), changes };
  }

  async resetRules() {
    const [fx, store] = await Promise.all([fixture(), rules()]);
    const state = await rulesState();
    const changes: ConfigChange[] = diffConfig(store.config, fx.defaults, state);
    if (changes.length) {
      store.config = cloneConfig(fx.defaults);
      store.version += 1;
      store.history = [...store.history, { id: `CFG-${String(store.version).padStart(4, "0")}`, version: store.version, at: nowKst(), actor: CURRENT_STAFF.name, note: "기본값(SPEC)으로 복원", summary: summarize(changes), changes }];
      save(KEY.rules, store);
    }
    return rulesState();
  }

  async getRuleHistory() {
    return [...(await rules()).history].reverse();
  }

  async getLogs() {
    const m = await import("../../demoData/admin/transferLogs.json");
    return m.default as unknown as TransferLog[];
  }

  async getScenarios() {
    const m = await import("../../demoData/admin/scenarios.json");
    return m.default as unknown as Scenario[];
  }

  async listCases(): Promise<CaseItem[]> {
    const items: CaseItem[] = [];
    for (const c of await allCases()) {
      const report = findReport(c.report_id);
      if (report) items.push({ case: c, report: toSummary(report) });
    }
    return items;
  }

  async getCase(id: string) {
    const c = (await allCases()).find((x) => x.case_id === id);
    const report = c && findReport(c.report_id);
    if (!c || !report) throw new Error("사례를 찾을 수 없어요.");
    return { case: c, report };
  }

  async saveCase(doc: CaseDoc) {
    const saved = { ...doc, updated_at: nowKst() };
    overrides()[saved.case_id] = saved;
    save(KEY.cases, overrides());
    return saved;
  }

  async reanalyze(caseId: string): Promise<ReanalyzeResult> {
    const { case: c, report } = await this.getCase(caseId);
    if (!c.delayed?.executed_at) throw new Error("송금이 실행된 건만 사후 확인을 할 수 있어요.");
    let activity = c.postcheck?.activity ?? [];
    if (!activity.length) {
      const fraudHit = report.account.signals.some((s) => s.signal === "payee_fraud" && s.hit);
      const fresh = report.account.signals.find((s) => s.signal === "payee_freshness");
      const suspicious = fraudHit || (fresh?.value != null && fresh.value <= 14);
      activity = makeActivity(c.delayed.executed_at, report.amount, suspicious, seededRandom(caseId));
    }
    return { activity, analysis: analyzeActivity(activity, nowKst()), llm: "demo" };
  }

  async narrate(_task: string, _facts: Record<string, unknown>, fallback: string): Promise<NarrativeResult> {
    return { text: fallback, llm: "demo" };
  }

  async simulateIncoming(): Promise<CaseDoc> {
    const pool = allDemoReports().filter((r) => r.final.final === "위험");
    const seed = pool[Math.floor(Math.random() * pool.length)];
    const created = await recordDemoChoice(seed, (["visit", "delayed", "delayed", "pending"] as CaseChoice[])[Math.floor(Math.random() * 4)], {});
    return created;
  }
}

/** 고객 화면(데모)에서 위험 결과 뒤 고객이 고른 분기를 본부 모니터링에 새 사례로 남긴다. 같은 데모를 다시 돌려도
 * 새 건으로 쌓이도록 리포트를 복제해 새 번호·현재 시각을 붙인다. */
export async function recordDemoChoice(source: ReportPayload, choice: CaseChoice, opts: { branch?: string; reservedAt?: string }): Promise<CaseDoc> {
  const list = extras();
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const day = kst.toISOString().slice(0, 10).replaceAll("-", "");
  const serial = list.filter((r) => r.report_id.startsWith(`RPT-${day}-9`)).length + 1;
  const iso = kstIso(now);
  const report: ReportPayload = { ...structuredClone(source), report_id: `RPT-${day}-9${String(serial).padStart(2, "0")}`, generated_at: iso, attempted_at: iso };
  list.push(report);
  save(KEY.reports, list);
  const doc = createCase(report, choice, now, await branchList(), opts);
  overrides()[doc.case_id] = doc;
  save(KEY.cases, overrides());
  return doc;
}
