export interface LightboxImage {
  name: string;
  /** 바로 <img src>에 넣을 수 있는 주소(data: URL 또는 절대 URL). */
  url: string;
}

interface Props {
  items: LightboxImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

/** 사진 크게 보기(채팅 첨부·영업점 리포트 공용). 바깥을 누르거나 ✕로 닫는다. */
export default function ImageLightbox({ items, index, onIndex, onClose }: Props) {
  const item = items[index];
  if (!item) return null;
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
        <img src={item.url} alt={item.name} />
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
        {/* data: URL은 브라우저가 새 탭으로 여는 걸 막는다 — 서버 파일일 때만 링크를 준다 */}
        {!item.url.startsWith("data:") && (
          <a className="lightbox-open" href={item.url} target="_blank" rel="noreferrer">
            새 창에서 원본 보기
          </a>
        )}
      </div>
    </div>
  );
}
