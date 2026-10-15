// 서버 없이(Vercel 데모·오프라인) 관리자 페이지를 쓰는 구현. 샘플 데이터는 실제 엔진으로 만든 시드이고,
// 사용자가 바꾼 설정·사례 처리 내용은 이 브라우저(localStorage)에만 저장된다 — 새로고침해도 유지되고 다른 사람과는 공유되지 않는다.
import { allDemoReports, toSummary } from "../../api/reports";
import { freshDemoReport, saveDemoReport } from "../../api/demoStore";
import type { AdminApi, NarrativeResult, ReanalyzeResult } from "./adminApi";
import { ConfigError } from "./adminApi";
import type {
  Branch, CaseChoice, CaseDoc, CaseItem, ConfigChange, ConfigHistoryEntry, ReportPayload, RagCandidate, RagEvalCase, RuleConfig, RuleInfo, RulesState, Scenario, ScenarioHistoryEntry, ScenarioInput, TransferLog,
} from "./types";
import { CURRENT_STAFF, cancelDelayed, cancelledByCustomer, createCase, noteHotline } from "../engine/cases";
import { kstIso } from "../format";
import { cloneConfig, diffConfig, summarize } from "../engine/configDiff";
import { analyzeActivity, makeActivity, seededRandom } from "../engine/postcheck";
import { validateConfig } from "../engine/validate";
import { scenarioErrors } from "../engine/rag";

const KEY = { rules: "pasugun.demo.rules.v2", cases: "pasugun.demo.cases.v2", logs: "pasugun.demo.logs.v2", scenarios: "pasugun.demo.scenarios.v2" };

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

function findReport(id: string): ReportPayload | undefined {
  return allDemoReports().find((r) => r.report_id === id);
}

async function allCases(): Promise<CaseDoc[]> {
  const base = await seedCases();
  const map = new Map<string, CaseDoc>(base.map((c) => [c.case_id, c]));
  for (const c of Object.values(overrides())) map.set(c.case_id, c);
  return [...map.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const nowKst = (): string => kstIso(new Date());

// ---------------------------------------------------------------- 사례집(RAG)
interface ScenarioEdits {
  version: number;
  /** 시드 사례를 고친 내용 + 새로 등록한 사례 */
  items: Record<string, Scenario>;
  history: ScenarioHistoryEntry[];
}

interface RagDemo {
  cases: { expected: string | null; text: string }[];
  results: Record<string, RagCandidate[]>;
}

let seedScenariosP: Promise<Scenario[]> | null = null;
const seedScenarios = (): Promise<Scenario[]> => (seedScenariosP ??= import("../../demoData/admin/scenarios.json").then((m) => m.default as unknown as Scenario[]));
let ragDemoP: Promise<RagDemo> | null = null;
const ragDemo = (): Promise<RagDemo> => (ragDemoP ??= import("../../demoData/admin/ragDemo.json").then((m) => m.default as unknown as RagDemo));

const scenarioEdits = (): ScenarioEdits => load<ScenarioEdits>(KEY.scenarios, { version: 1, items: {}, history: [] });

async function allScenarios(): Promise<Scenario[]> {
  const edits = scenarioEdits();
  const map = new Map<string, Scenario>((await seedScenarios()).map((s) => [s.id, { ...s, enabled: true }]));
  for (const s of Object.values(edits.items)) map.set(s.id, s);
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** 데모는 문장을 임베딩할 수 없어 실제 엔진으로 미리 계산한 순위를 쓴다. 중지한 사례는 빼면 서버와 같은 결과다
 * (색인에서 문서를 빼도 다른 사례의 유사도는 그대로). 새로 등록·수정한 사례는 순위에 반영되지 않는다. */
async function demoRanking(text: string): Promise<RagCandidate[] | null> {
  const ranked = (await ragDemo()).results[text.trim()];
  if (!ranked) return null;
  const off = new Set((await allScenarios()).filter((s) => s.enabled === false).map((s) => s.id));
  return ranked.filter((c) => !off.has(c.scenario_id));
}

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
    // 시드 로그 + 이 브라우저에서 시연한 거래(실제 모드에서 서버가 모든 판정을 로그로 남기는 것과 같다)
    return [...(m.default as unknown as TransferLog[]), ...load<TransferLog[]>(KEY.logs, [])];
  }

  getScenarios() {
    return allScenarios();
  }

  async saveScenario(id: string | null, raw: ScenarioInput, note = "") {
    // 서버와 같이 태그 띄어쓰기를 지워 맞춘다('안전 계좌' → 결정적 징후 '안전계좌')
    const input: ScenarioInput = { ...raw, 위험신호: [...new Set(raw.위험신호.map((t) => t.replace(/\s+/g, "")).filter(Boolean))] };
    const errors = scenarioErrors(input);
    if (errors.length) throw new ConfigError(errors);
    const all = await allScenarios();
    const edits = scenarioEdits();
    const old = id ? all.find((s) => s.id === id) : undefined;
    if (id && !old) throw new Error("사례를 찾을 수 없어요.");
    const nextId = `S${String(Math.max(0, ...all.map((s) => Number(s.id.slice(1)) || 0)) + 1).padStart(2, "0")}`;
    const doc: Scenario = { ...(old ?? {}), ...input, id: id ?? nextId, updated_at: nowKst(), updated_by: CURRENT_STAFF.name };
    const fields = (Object.keys(input) as (keyof ScenarioInput)[]).filter((k) => JSON.stringify(old?.[k] ?? (k === "enabled" ? true : undefined)) !== JSON.stringify(input[k]));
    if (old && !fields.length) return { scenario: old, nearest: null };
    const [action, summary]: [ScenarioHistoryEntry["action"], string] = !old
      ? ["등록", `${doc.유형} · ${doc.중분류} 사례 등록`]
      : fields.length === 1 && fields[0] === "enabled"
        ? input.enabled ? ["사용", "검색에 다시 사용"] : ["중지", "검색에서 제외"]
        : ["수정", `수정: ${fields.join(", ")}`];
    edits.version += 1;
    edits.items[doc.id] = doc;
    edits.history.push({ version: edits.version, at: nowKst(), actor: CURRENT_STAFF.name, note, scenario_id: doc.id, action, summary });
    save(KEY.scenarios, edits);
    return { scenario: doc, nearest: null };
  }

  async getScenarioHistory() {
    return [...scenarioEdits().history].reverse();
  }

  searchRag(text: string) {
    return demoRanking(text);
  }

  async evaluateRag(): Promise<RagEvalCase[]> {
    const { cases } = await ragDemo();
    return Promise.all(cases.map(async (c) => ({ ...c, candidates: (await demoRanking(c.text)) ?? [] })));
  }

  listBranches() {
    return branchList();
  }

  async listCases(): Promise<CaseItem[]> {
    caseOverrides = null; // 다른 탭(고객 화면)에서 바뀐 내용까지 읽도록 매번 저장소에서 다시 읽는다
    const items: CaseItem[] = [];
    for (const c of await allCases()) {
      const report = findReport(c.report_id);
      if (report) items.push({ case: c, report: toSummary(report) });
    }
    return items;
  }

  async getCase(id: string) {
    caseOverrides = null;
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
    const pool = allDemoReports().filter((r) => r.final.final === "위험" && !/-9\d\d$/.test(r.report_id));
    const report = freshDemoReport(pool[Math.floor(Math.random() * pool.length)]);
    await openDemoCase(report);
    const choice = (["visit", "delayed", "delayed", "pending"] as CaseChoice[])[Math.floor(Math.random() * 4)];
    return choice === "pending" ? (await this.getCase(report.report_id)).case : recordDemoChoice(report, choice, {});
  }
}

// 시연 케이스 고객의 프로필(backend/mock_data/customers.json과 같은 값) — 통계의 연령대·지역에 쓴다.
const DEMO_CUSTOMERS: Record<string, { id: string; age: string; region: string; hours: number[] }> = {
  남용준: { id: "C001", age: "30대", region: "서울 강남구", hours: [9, 22] },
  김도현: { id: "C002", age: "20대", region: "서울 마포구", hours: [8, 21] },
  이서인: { id: "C003", age: "20대", region: "경기 성남시", hours: [9, 23] },
  박지원: { id: "C004", age: "50대", region: "서울 서초구", hours: [9, 20] },
};

/** 데모 결과 화면에 들어온 순간 판정 1건을 거래 로그로 남긴다(서버 finalize의 transfer_log와 같은 모양). */
export function logDemoDecision(args: {
  customerName: string;
  amount: number;
  payeeAccount: string;
  payeeBank: string;
  final: ReportPayload["final"];
  account: ReportPayload["account"];
  context: ReportPayload["context"];
  reportId: string | null;
}): void {
  const who = DEMO_CUSTOMERS[args.customerName] ?? { id: "C000", age: "", region: "", hours: [9, 22] };
  const now = new Date();
  const list = load<TransferLog[]>(KEY.logs, []);
  const ctx = args.context;
  const by = (q: string) => ctx?.answers.find((a) => a.question_id === q);
  const rag = ctx?.rag ?? null;
  const day = kstIso(now).slice(0, 10).replaceAll("-", "");
  list.push({
    log_id: `TXN-${day}-D${String(list.length + 1).padStart(3, "0")}`,
    at: kstIso(now),
    customer_id: who.id,
    customer_age_group: who.age,
    customer_region: who.region,
    amount: args.amount,
    payee_account: args.payeeAccount,
    payee_bank: args.payeeBank,
    usual_hours: who.hours,
    signals: args.account.signals.map((x) => ({ signal: x.signal, value: x.value ?? null, score: x.score, hit: x.hit })),
    account_total: args.account.total_score,
    account_level: args.account.level,
    asked: !!ctx && (ctx.answers.length > 0 || ctx.used_input_or_attachment),
    answers_empathy: by("empathy")?.choice_weight ?? null,
    answers_safety: by("safety")?.choice_weight ?? null,
    answer_hard: !!ctx?.answers.some((a) => a.hard_override),
    input_used: !!ctx?.used_input_or_attachment,
    rag_id: rag?.hit ? rag.matched_id : null,
    rag_type: rag?.hit ? rag.matched_type : null,
    rag_similarity: rag ? rag.similarity : null,
    context_total: ctx ? ctx.total_score : null,
    context_level: args.final.context_level,
    hard_override: args.final.hard_override,
    final: args.final.final,
    report_id: args.reportId,
    truth: null,
    scenario: null,
  });
  save(KEY.logs, list.slice(-200));
}

/** 데모 결과 화면에 '위험' 리포트가 나온 순간(서버의 finalize와 같은 시점): 리포트를 저장하고 '고객 선택 대기' 사례를 연다. */
export async function openDemoCase(report: ReportPayload): Promise<CaseDoc> {
  saveDemoReport(report);
  const existing = overrides()[report.report_id];
  if (existing) return existing;
  const doc = createCase(report, "pending", new Date(), await branchList());
  overrides()[doc.case_id] = doc;
  save(KEY.cases, overrides());
  return doc;
}

/** 고객이 위험 결과 뒤 고른 분기를 사례에 반영한다. 처음 고른 것만 인정한다(서버의 apply_customer_choice와 같다). */
export async function recordDemoChoice(report: ReportPayload, choice: CaseChoice, opts: { branch?: string; reservedAt?: string }): Promise<CaseDoc> {
  let opened = await openDemoCase(report);
  // 송금을 취소한 뒤 영업점 상담을 예약하면 사례를 다시 연다(서버 reopen_as_visit와 같다).
  const reopening = choice === "visit" && cancelledByCustomer(opened);
  if (reopening) {
    const at = kstIso(new Date());
    opened = { ...opened, timeline: [...opened.timeline, { at, actor: "고객", kind: "reopen", text: "송금을 취소한 뒤 영업점 상담을 예약해 사례를 다시 열었어요." }] };
  } else if (opened.choice !== "pending") return opened;
  const doc = createCase(report, choice, new Date(), await branchList(), opts);
  doc.created_at = opened.created_at;
  doc.hotlines = opened.hotlines ?? [];
  doc.timeline = [...opened.timeline, ...doc.timeline.slice(1)];
  overrides()[doc.case_id] = doc;
  save(KEY.cases, overrides());
  return doc;
}

/** 고객이 결과·취소 화면에서 112·1332 안내를 확인한 경우. */
export async function noteDemoHotline(report: ReportPayload, line: "112" | "1332"): Promise<void> {
  const opened = await openDemoCase(report);
  const next = noteHotline(opened, line, kstIso(new Date()));
  if (next === opened) return;
  overrides()[next.case_id] = next;
  save(KEY.cases, overrides());
}

/** 지연이체로 접수한 고객이 실행 전에 직접 취소한 경우. */
export async function cancelDemoDelayed(reportId: string): Promise<CaseDoc | null> {
  const doc = overrides()[reportId];
  if (!doc || doc.choice !== "delayed" || doc.delayed?.executed_at || doc.status === "종결") return doc ?? null;
  const next = cancelDelayed(doc, kstIso(new Date()));
  overrides()[next.case_id] = next;
  save(KEY.cases, overrides());
  return next;
}
