// 관리자 페이지의 '영향 미리보기' 재채점(TS)이 서버의 실제 엔진과 같은 결과를 내는지 정답지로 확인한다.
// 정답지는 backend/scripts/generate_seed_data.py가 실제 엔진으로 만든다. 실행: npm run check:golden
import { readFileSync } from "node:fs";
import { checkGolden } from "../src/admin/engine/backtest.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const logs = read("../src/demoData/admin/transferLogs.json");
const scenarios = read("../src/demoData/admin/scenarios.json");
const golden = read("../src/admin/__golden__/rescore.json");
const corpus = new Map(scenarios.map((s: { id: string }) => [s.id, s]));

let bad = 0;
for (const r of checkGolden(logs, corpus, golden)) {
  bad += r.mismatches.length;
  console.log(`${r.config}: ${r.checked}건 확인, 불일치 ${r.mismatches.length}건`, r.mismatches.length ? JSON.stringify(r.mismatches.slice(0, 3)) : "");
}
process.exit(bad ? 1 : 0);
