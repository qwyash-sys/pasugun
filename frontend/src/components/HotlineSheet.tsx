import BottomSheet from "./BottomSheet";

// 112·1332 버튼: 눌러도 아무 반응이 없으면 고장난 것처럼 보인다. 시연 중 실수로 실제 신고 전화가
// 걸리면 곤란하므로 전화 연결 대신 어떤 번호이고 언제 거는지를 안내한다(결과 화면·취소 완료 화면 공통).
export const HOTLINES = {
  "112": {
    label: "112(경찰) 신고",
    title: "112(경찰) 신고",
    body: "돈을 이미 보냈거나 보내라는 압박을 받고 있다면 112에 바로 신고하세요. 신고와 함께 지급정지를 요청할 수 있어요.",
  },
  "1332": {
    label: "1332(콜센터) 상담",
    title: "1332(콜센터) 상담",
    body: "보이스피싱인지 확신이 서지 않을 때 금융감독원 보이스피싱 전담 콜센터 1332에서 상담받을 수 있어요. 피해 구제 절차도 안내받을 수 있어요.",
  },
} as const;

export type Hotline = keyof typeof HOTLINES;

export default function HotlineSheet({ hotline, onClose }: { hotline: Hotline; onClose: () => void }) {
  return (
    <BottomSheet>
      <h2 className="sheet-title">{HOTLINES[hotline].title}</h2>
      <p className="sheet-body">
        {HOTLINES[hotline].body}
        <br />
        <span className="sheet-demo-note">시연용 화면이라 실제 전화는 연결하지 않아요.</span>
      </p>
      <button className="btn btn-primary" onClick={onClose}>
        확인
      </button>
    </BottomSheet>
  );
}
