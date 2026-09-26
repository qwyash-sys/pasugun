// 목업 리포트의 첨부자료(문자 캡처)는 원본 이미지가 없어 문구만 들고 있다. 데모 모드엔
// 백엔드가 없으므로 backend/app/report_store.py의 render_capture_svg와 같은 모양을 여기서 그린다.
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function captureDataUrl(lines: string[]): string {
  const lineH = 28;
  const bubbleH = 24 + lineH * lines.length;
  const height = 120 + bubbleH;
  const texts = lines
    .map((line, i) => `<text x="44" y="${112 + i * lineH}" font-size="17" fill="#17191c">${escapeXml(line)}</text>`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="${height}" viewBox="0 0 420 ${height}">` +
    `<rect width="420" height="${height}" fill="#f4f5f6"/>` +
    `<rect width="420" height="52" fill="#ffffff"/>` +
    `<text x="210" y="32" font-size="16" font-weight="700" text-anchor="middle" fill="#17191c">문자 메시지</text>` +
    `<rect x="24" y="76" width="372" height="${bubbleH}" rx="16" fill="#ffffff" stroke="#e9eaec"/>` +
    `${texts}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
