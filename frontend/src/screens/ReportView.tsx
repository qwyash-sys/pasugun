import { useState, type ReactNode } from "react";
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

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="report-section">
      <h2 className="report-section-title">
        {title}
        {aside && <span className="report-section-aside">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

const VERDICT_TONE = { 안전: "safe", 주의: "warn", 위험: "danger" } as const;

export default function ReportView({ report, backLabel, onBack, onOpenList, onRestart }: Props) {
  const [viewing, setViewing] = useState<number | null>(null);
  const attachments = report.attachments ?? [];
  const { final } = report;

  return (
    <>
      <AppBar title="영업점 연계 리포트" onBack={onBack} onHome={onRestart} />

      {/* 한눈에: 판정 · 금액 · 누가 누구에게 */}
      <div className={`report-hero tone-${VERDICT_TONE[final.final]}`}>
        <div className="report-hero-top">
          <span className="report-hero-verdict">{final.final}</span>
          <span className="report-hero-id">#{report.report_id}</span>
        </div>
        <div className="report-hero-amount">{report.amount.toLocaleString()}원</div>
        <div className="report-hero-parties">
          {report.customer_name} → {report.payee_name} <span>({report.payee_bank})</span>
        </div>
        <div className="report-hero-tags">
          <span className={`tag level-${final.account_level}`}>송금위험 {final.account_level}</span>
          <span className={`tag level-${final.context_level}`}>AI분석 {final.context_level}</span>
          {final.hard_override && <span className="tag tag-danger">결정적 피싱징후</span>}
        </div>
      </div>

      <Section title="권고 조치">
        <p className="report-callout">{report.recommendation}</p>
      </Section>

      <Section title="시도 거래">
        <dl className="info-list">
          <InfoRow label="받는 분">{report.payee_name}</InfoRow>
          <InfoRow label="입금 계좌">
            {report.payee_bank} {report.payee_account}
          </InfoRow>
          <InfoRow label="금액">{report.amount.toLocaleString()}원</InfoRow>
          <InfoRow label="시도 일시">{formatDateTime(report.attempted_at)}</InfoRow>
        </dl>
      </Section>

      <Section title="고객 정보">
        <dl className="info-list">
          <InfoRow label="이름">{report.customer_name}</InfoRow>
          <InfoRow label="연락처">{report.customer_phone_masked}</InfoRow>
          <InfoRow label="출금 계좌">{report.customer_account_masked}</InfoRow>
        </dl>
      </Section>

      <Section title="AI 대화 진단 요약">
        <p className="report-quote">{report.conversation_summary}</p>
      </Section>

      <Section title="첨부자료" aside={attachments.length ? `${attachments.length}건 · 눌러서 크게 보기` : "없음"}>
        {attachments.length > 0 ? (
          <div className="attach-grid">
            {attachments.map((a, i) => (
              <button key={`${a.name}-${i}`} className="attach-thumb" onClick={() => setViewing(i)}>
                <img src={resolveAssetUrl(a.url)} alt={a.name} />
                <span>{a.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="report-empty">고객이 올린 캡처·사진이 없어요.</p>
        )}
      </Section>

      <Section title="AI파수꾼 위험 판정 근거" aside="1단계 · 2단계 · 3단계">
        <RiskBreakdown account={report.account} context={report.context} />
      </Section>

      <p className="report-generated">리포트 생성 {formatDateTime(report.generated_at)}</p>

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
