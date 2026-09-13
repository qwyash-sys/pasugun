interface Props {
  busy: boolean;
  error: string | null;
  onRetry: (() => void) | null;
  onCancel: () => void;
}

// M3a/M4처럼 "동작 하나 실행 후 다음 화면"인 단계에서 로딩/실패를 공통으로 보여준다.
export default function LoadingOrError({ busy, error, onRetry, onCancel }: Props) {
  if (busy) {
    return (
      <div className="loading-wrap">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="loading-wrap">
      <p style={{ color: "var(--danger)", textAlign: "center" }}>{error}</p>
      <div className="btn-row" style={{ width: "100%" }}>
        <button className="btn btn-secondary" onClick={onCancel}>
          처음으로
        </button>
        {onRetry && (
          <button className="btn btn-primary" onClick={onRetry}>
            다시 시도
          </button>
        )}
      </div>
    </div>
  );
}
