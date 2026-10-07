// 사례에 연결된 위험 리포트(1단계 룰 점수 · 2단계 AI분석 · 유사 사기사례) 요약. 본부 담당자가 판단 근거를 확인하는 곳.
import type { ReportPayload } from "../../../types";
import { resolveAssetUrl } from "../../../api/reports";
import { fmtDateTime, won } from "../../format";
import { Badge, type Tone } from "../../components/ui";

const LEVEL_TONE: Record<string, Tone> = { 고: "danger", 중: "warn", 저: "green" };

export default function ReportSection({ report }: { report: ReportPayload }) {
  const f = report.final;
  const ctx = report.context;
  const rag = report.rag;
  return (
    <div className="c-stack">
      <dl className="c-kv">
        <dt>고객</dt>
        <dd>
          {report.customer_name} · {report.customer_phone_masked} · 출금 {report.customer_account_masked}
          {report.customer_age_group && ` · ${report.customer_age_group} · ${report.customer_region ?? ""}`}
        </dd>
        <dt>수취</dt>
        <dd>
          {report.payee_bank} {report.payee_account} · {report.payee_name}
        </dd>
        <dt>금액</dt>
        <dd>
          <b>{won(report.amount)}</b>
        </dd>
        <dt>시도 일시</dt>
        <dd>{fmtDateTime(report.attempted_at)}</dd>
        <dt>최종 판정</dt>
        <dd>
          <Badge tone="danger">{f.final}</Badge> 송금위험도 <Badge tone={LEVEL_TONE[f.account_level]}>{f.account_level}</Badge> · AI분석 <Badge tone={LEVEL_TONE[f.context_level]}>{f.context_level}</Badge>
          {f.hard_override && <Badge tone="danger"> 결정적 피싱징후</Badge>}
        </dd>
      </dl>

      <div>
        <h4 className="c-sec">1단계 · 송금위험도 {report.account.total_score}점</h4>
        <div className="c-table-wrap">
          <table className="c-table">
            <thead>
              <tr>
                <th>룰</th>
                <th className="num">점수</th>
                <th>근거</th>
              </tr>
            </thead>
            <tbody>
              {report.account.signals.map((s) => (
                <tr key={s.signal} className={s.hit ? "" : "c-dim"}>
                  <td>
                    <b>{s.rule_id ?? ""}</b> {s.label ?? s.signal}
                  </td>
                  <td className="num">
                    {s.score}
                    {s.max_score != null && <span className="c-muted">/{s.max_score}</span>}
                  </td>
                  <td className="c-small">{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="c-sec">2단계 · AI 분석 {ctx ? `${ctx.total_score}점` : ""}</h4>
        {ctx ? (
          <>
            <p className="c-small c-muted" style={{ margin: "0 0 8px" }}>
              질문 응답 {ctx.answers.length}개 · {ctx.used_input_or_attachment ? "직접 입력/첨부 있음" : "직접 입력/첨부 없음"}
              {ctx.hard_override && " · 결정적 피싱징후 응답 있음"}
            </p>
            {rag && rag.hit ? (
              <div className="c-note tone-purple">
                <b>유사 사기사례</b> {rag.matched_type} · 유사도 {Math.round(rag.similarity * 100)}%
                <br />
                겹친 위험신호: {rag.risk_signals.join(" · ") || "-"}
                {rag.source && (
                  <>
                    <br />
                    <span className="c-small">출처: {rag.source}</span>
                  </>
                )}
              </div>
            ) : (
              <p className="c-muted c-small">유사한 사기 사례가 발견되지 않았어요.</p>
            )}
          </>
        ) : (
          <p className="c-muted c-small">2단계 분석 없이 접수된 건이에요.</p>
        )}
      </div>

      {report.conversation_summary && (
        <div>
          <h4 className="c-sec">고객 상담 요약</h4>
          <p className="c-text-block">{report.conversation_summary}</p>
        </div>
      )}

      <div>
        <h4 className="c-sec">판정 사유 · 권고</h4>
        <ul className="c-reasons">
          {f.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="c-text-block">{report.recommendation}</p>
      </div>

      {report.attachments.length > 0 && (
        <div>
          <h4 className="c-sec">첨부 {report.attachments.length}건</h4>
          <div className="c-attach">
            {report.attachments.map((a) => (
              <a key={a.url} href={resolveAssetUrl(a.url)} target="_blank" rel="noreferrer" title={a.name}>
                <img src={resolveAssetUrl(a.url)} alt={a.name} loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
