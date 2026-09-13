import AppBar from "../components/AppBar";
import RiskBreakdown from "../components/RiskBreakdown";
import type { Question, ReportPayload } from "../types";

interface Props {
  report: ReportPayload;
  questions: Question[];
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

export default function ReportView({ report, questions, onBack, onRestart }: Props) {
  return (
    <>
      <AppBar title="영업점 연계 리포트" onBack={onBack} />
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
        <Row label="대화 진단 요약" value={report.conversation_summary} />
        <Row label="첨부자료" value={report.attachments_present ? "있음" : "없음"} />
        <Row label="권고 조치" value={report.recommendation} />
        <Row label="생성 일시" value={report.generated_at} />
      </div>

      <p className="field-label" style={{ marginTop: 16 }}>
        위험 판정 상세 근거
      </p>
      <RiskBreakdown account={report.account} context={report.context} questions={questions} />

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
