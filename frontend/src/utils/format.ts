/** 금액을 한국식 단위로 읽어준다 — 20,000,000 → "2,000만원", 123,456,789 → "1억 2,345만 6,789원".
 * 은행 앱처럼 숫자 아래 보조 표기로 써서 0 하나 더 붙이는 송금 실수를 막는다. */
export function koreanAmount(won: number): string {
  if (!Number.isFinite(won) || won <= 0) return "0원";
  const eok = Math.floor(won / 1e8);
  const man = Math.floor((won % 1e8) / 1e4);
  const rest = Math.floor(won % 1e4);
  const parts = [];
  if (eok) parts.push(`${eok.toLocaleString()}억`);
  if (man) parts.push(`${man.toLocaleString()}만`);
  if (rest) parts.push(rest.toLocaleString());
  return `${parts.join(" ")}원`;
}
