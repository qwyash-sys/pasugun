import TopBar from "../components/TopBar";
import type { ReportPayload } from "../types";

interface Props {
  report: ReportPayload;
  onBack: () => void;
  onRestart: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="report-row">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

export default function ReportView({ report, onBack, onRestart }: Props) {
  return (
    <>
      <TopBar />
      <h1 className="title">멈칫 사기의심 거래 리포트</h1>
      <p className="subtitle">#{report.report_id}</p>

      <div className="report-sheet">
        <Row label="고객 정보" value={`${report.customer_name} / ${report.customer_phone_masked} / ${report.customer_account_masked}`} />
        <Row
          label="시도 거래"
          value={`${report.payee_bank} ${report.payee_account} (예금주: ${report.payee_name}) / ${report.amount.toLocaleString()}원`}
        />
        <Row label="시도 일시" value={report.attempted_at} />
        <Row
          label="최종 위험 판정"
          value={`${report.final.final} (계좌 ${report.final.account_level} / 맥락 ${report.final.context_level})`}
        />
        <Row label="계좌 신호 근거" value={report.account_reasons.join(", ")} />
        <Row label="대화 진단 요약" value={report.conversation_summary} />
        <Row label="첨부자료" value={report.attachments_present ? "있음" : "없음"} />
        {report.rag && report.rag.hit && (
          <Row
            label="RAG 매칭 결과"
            value={`${report.rag.matched_type} 유형, 유사도 ${report.rag.similarity.toFixed(2)}, 위험신호: ${report.rag.risk_signals.join("·")} (${report.rag.source})`}
          />
        )}
        <Row label="권고 조치" value={report.recommendation} />
        <Row label="생성 일시" value={report.generated_at} />
      </div>

      <div className="spacer" />
      <div className="btn-row">
        <button className="btn btn-secondary" onClick={onBack}>
          뒤로
        </button>
        <button className="btn btn-primary" onClick={onRestart}>
          처음으로
        </button>
      </div>
    </>
  );
}
