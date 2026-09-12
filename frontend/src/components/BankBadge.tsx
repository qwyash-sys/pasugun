// 실제 올원뱅크 최근 수취인 목록의 은행별 컬러 배지를 따라한다(카카오뱅크 노랑, 신한 파랑 등).
const BANK_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  카카오뱅크: { bg: "#FEE500", color: "#3C1E1E", label: "카" },
  신한은행: { bg: "#0046FF", color: "#fff", label: "신" },
  국민은행: { bg: "#FFB300", color: "#3C2A00", label: "국" },
  우리은행: { bg: "#0067AC", color: "#fff", label: "우" },
  미래에셋증권: { bg: "#F58220", color: "#fff", label: "미" },
  NH농협은행: { bg: "#00A651", color: "#fff", label: "NH" },
};

const FALLBACK = { bg: "#9AA1A9", color: "#fff" };

export default function BankBadge({ bank }: { bank: string }) {
  const style = BANK_STYLE[bank];
  const label = style?.label ?? bank.slice(0, 1);
  const bg = style?.bg ?? FALLBACK.bg;
  const color = style?.color ?? FALLBACK.color;

  return (
    <div className="bank-badge" style={{ background: bg, color }}>
      {label}
    </div>
  );
}
