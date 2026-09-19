// local/remote(실제) 모드 전용 개발용 빠른 입력. 실제 모드는 입력값으로 점수를 진짜 계산하기 때문에
// 임의의 금액·계좌를 넣으면 대부분 저위험("확인 1탭")으로 끝나 채팅 단계까지 못 간다. SPEC 5장
// 케이스를 만들어내는 실제 입력값(backend/tests/test_scoring.py와 동일)을 버튼으로 채워준다.
import type { TransferQuoteRequest } from "../types";

export interface TestScenario {
  label: string;
  hint: string;
  customerId: string;
  amount: number;
  payeeBank: string;
  payeeAccount: string;
  /** SPEC 5장 케이스가 가정한 시각. 지금 시각을 쓰면 새벽 접속 시 이용시간대 신호(+5~10)가 붙어 점수가 달라진다. */
  currentTime: string;
  overrides: TransferQuoteRequest["context_overrides"];
}

export const TEST_SCENARIOS: TestScenario[] = [
  {
    label: "🔴 검찰사칭",
    hint: "질문 2개 + 채팅",
    customerId: "C001",
    amount: 20_000_000,
    payeeBank: "미래에셋증권",
    payeeAccount: "010-6660-98261",
    currentTime: "2026-08-11T01:10:00+09:00",
    overrides: { fund_source_recent: true },
  },
  {
    label: "🔴 대환대출",
    hint: "질문 2개 + 채팅",
    customerId: "C002",
    amount: 5_000_000,
    payeeBank: "신한은행",
    payeeAccount: "110-452-118834",
    currentTime: "2026-08-09T11:00:00+09:00",
    overrides: { limit_changed_recent: true },
  },
  {
    label: "🔴 메신저피싱",
    hint: "질문 1개 + 채팅 (계좌점수는 낮음)",
    customerId: "C001",
    amount: 1_000_000,
    payeeBank: "카카오뱅크",
    payeeAccount: "301-8827-4410",
    currentTime: "2026-08-12T15:00:00+09:00",
    overrides: {},
  },
  {
    label: "🟢 중고거래",
    hint: "질문·채팅 없이 확인 1탭",
    customerId: "C001",
    amount: 150_000,
    payeeBank: "국민은행",
    payeeAccount: "552-102-993841",
    currentTime: "2026-08-13T18:00:00+09:00",
    overrides: {},
  },
  {
    label: "🟢 부동산 잔금",
    hint: "질문 1개, 정상 사유 선택 시 통과",
    customerId: "C004",
    amount: 50_000_000,
    payeeBank: "우리은행",
    payeeAccount: "088-19-284755",
    currentTime: "2026-08-14T11:00:00+09:00",
    overrides: {},
  },
];
