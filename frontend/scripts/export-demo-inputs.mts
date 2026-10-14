// 데모 시연 케이스의 '입력'(고객·계좌·금액·시각·이벤트, 추천 답변, 대화 문장, 첨부 캡처 글자)을 JSON으로 내보낸다.
// backend/scripts/generate_demo_cases.py가 이 입력을 개발 모드와 똑같은 API 흐름(quote → answers → chat → finalize)에
// 넣어 점수·판정·리포트를 계산하고 src/demoData/engineCases.json에 저장한다 — 데모와 개발 모드의 기준을 맞추기 위함.
// 실행: npx -y tsx scripts/export-demo-inputs.mts > ../backend/scripts/demo_inputs.json
import { DEMO_CASES } from "../src/demoData/cases.ts";
import { scenarioForCase } from "../src/demoData/testScenarios.ts";

/** captureDataUrl(SVG)에 들어간 글자 줄을 다시 꺼낸다(서버 OCR이 읽어낼 글자와 같은 내용). */
function captureLines(url: string): string[] {
  const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) =>
    m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
  );
}

const out = DEMO_CASES.map((c) => {
  const s = scenarioForCase(c.title);
  if (!s) throw new Error(`시나리오 없음: ${c.title}`);
  const byName = new Map((c.report?.attachments ?? []).map((a) => [a.name, a.url]));
  return {
    id: c.id,
    title: c.title,
    customer_id: s.customerId,
    payee_account: s.payeeAccount,
    amount: s.amount,
    current_time: s.currentTime,
    overrides: s.overrides ?? {},
    answers: c.scriptedAnswers ?? {},
    chat: c.chatTurns.map((t) => ({
      text: t.user,
      attachments: (t.attachments ?? []).map((name) => ({ name, lines: byName.has(name) ? captureLines(byName.get(name)!) : [name] })),
    })),
  };
});
console.log(JSON.stringify(out, null, 2));
