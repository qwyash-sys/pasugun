// '지금 설정'과 '바꾼 설정'을 같은 과거 거래에 적용했을 때의 차이.
import type { BacktestResult } from "../../engine/backtest";

const ROWS: { key: "fraudMissed" | "fraudCaution" | "fraudRisk" | "falseRisk" | "falseCaution" | "risk"; label: string; goodWhenDown: boolean }[] = [
  { key: "fraudMissed", label: "놓친 사기(안전으로 통과)", goodWhenDown: true },
  { key: "fraudCaution", label: "주의로만 통과한 사기", goodWhenDown: true },
  { key: "fraudRisk", label: "위험으로 막은 사기", goodWhenDown: false },
  { key: "falseRisk", label: "위험으로 막은 정상 거래", goodWhenDown: true },
  { key: "falseCaution", label: "주의로 분류된 정상 거래", goodWhenDown: true },
  { key: "risk", label: "위험 판정 전체", goodWhenDown: false },
];

export function ImpactTable({ result }: { result: BacktestResult }) {
  const worse = result.next.fraudMissed > result.base.fraudMissed;
  return (
    <div className="c-impact">
      <div className="c-impact-head">
        <strong>과거 거래 {result.base.labeled}건에 적용해 본 결과</strong>
        <span className="c-muted c-small">판정이 바뀌는 거래 {result.changed.length}건</span>
      </div>
      <table className="c-table">
        <thead>
          <tr>
            <th>항목</th>
            <th className="num">지금</th>
            <th className="num">변경 후</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const a = result.base[r.key];
            const b = result.next[r.key];
            const dir = b === a ? "" : (b < a) === r.goodWhenDown ? "better" : "worse";
            return (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="num">{a}건</td>
                <td className={`num c-delta ${dir}`}>
                  {b}건 {b !== a && <small>({b > a ? "+" : ""}{b - a})</small>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {worse && (
        <div className="c-note tone-danger" role="alert">
          놓치는 사기가 늘어요. 사기 탐지를 낮추는 변경이니 신중하게 판단하세요.
        </div>
      )}
      {result.keptStoredScores > 0 && <p className="c-muted c-small">원시 측정값이 없는 {result.keptStoredScores}건은 저장된 점수를 그대로 써서 계산했어요.</p>}
    </div>
  );
}
