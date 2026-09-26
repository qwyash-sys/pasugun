import { useState } from "react";
import AppBar from "../components/AppBar";
import RiskBreakdown from "../components/RiskBreakdown";
import { resolveAssetUrl } from "../api/reports";
import type { AttachmentMeta, ReportPayload } from "../types";

interface Props {
  report: ReportPayload;
  backLabel: string;
  onBack: () => void;
  onOpenList: () => void;
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

function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

export default function ReportView({ report, backLabel, onBack, onOpenList, onRestart }: Props) {
  const [viewing, setViewing] = useState<number | null>(null);
  const attachments = report.attachments ?? [];

  return (
    <>
      <AppBar title="영업점 연계 리포트" onBack={onBack} onHome={onRestart} />
      <h1 className="title">AI파수꾼 사기의심 거래 리포트</h1>
      <p className="subtitle">#{report.report_id}</p>

      <div className="report-sheet">
        <Row label="고객 정보" value={`${report.customer_name} / ${report.customer_phone_masked} / ${report.customer_account_masked}`} />
        <Row
          label="시도 거래"
          value={`${report.payee_bank} ${report.payee_account} (예금주: ${report.payee_name}) / ${report.amount.toLocaleString()}원`}
        />
        <Row label="시도 일시" value={formatDateTime(report.attempted_at)} />
        <Row
          label="최종 위험 판정"
          value={`${report.final.final} (계좌 ${report.final.account_level} / 맥락 ${report.final.context_level})`}
        />
        <Row label="대화 진단 요약" value={report.conversation_summary} />
        <Row label="첨부자료" value={attachments.length ? `${attachments.length}건` : "없음"} />
        <Row label="권고 조치" value={report.recommendation} />
        <Row label="생성 일시" value={formatDateTime(report.generated_at)} />
      </div>

      {attachments.length > 0 && (
        <>
          <p className="field-label" style={{ marginTop: 16 }}>
            첨부자료 보기 · 눌러서 크게 보기
          </p>
          <div className="attach-grid">
            {attachments.map((a, i) => (
              <button key={`${a.name}-${i}`} className="attach-thumb" onClick={() => setViewing(i)}>
                <img src={resolveAssetUrl(a.url)} alt={a.name} />
                <span>{a.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="field-label" style={{ marginTop: 16 }}>
        위험 판정 상세 근거
      </p>
      <RiskBreakdown account={report.account} context={report.context} />

      <div className="spacer" />
      <button className="btn btn-outline" style={{ marginBottom: 10 }} onClick={onOpenList}>
        📋 AI파수꾼 리포트 목록
      </button>
      <div className="btn-row">
        <button className="btn btn-secondary" onClick={onBack}>
          {backLabel}
        </button>
        <button className="btn btn-primary" onClick={onRestart}>
          처음으로
        </button>
      </div>

      {viewing !== null && (
        <AttachmentLightbox items={attachments} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

function AttachmentLightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: AttachmentMeta[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  return (
    <div className="lightbox" role="dialog" aria-label={item.name} onClick={onClose}>
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-head">
          <span>
            {item.name} · {index + 1}/{items.length}
          </span>
          <button onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <img src={resolveAssetUrl(item.url)} alt={item.name} />
        {items.length > 1 && (
          <div className="btn-row">
            <button className="btn btn-secondary" disabled={index === 0} onClick={() => onIndex(index - 1)}>
              이전
            </button>
            <button className="btn btn-secondary" disabled={index === items.length - 1} onClick={() => onIndex(index + 1)}>
              다음
            </button>
          </div>
        )}
        {/* 데모 목업은 data: URL이라 새 탭으로 열 수 없다(브라우저가 차단) — 서버 파일일 때만 링크를 준다. */}
        {!item.url.startsWith("data:") && (
          <a className="lightbox-open" href={resolveAssetUrl(item.url)} target="_blank" rel="noreferrer">
            새 창에서 원본 보기
          </a>
        )}
      </div>
    </div>
  );
}
