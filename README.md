# 멈칫(Meomchit)

SPEC.md 기준 프로토타입. `backend/`(FastAPI) + `frontend/`(React/Vite) 두 서비스로 구성.

## 실행

### backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate   # (Windows) / source .venv/bin/activate (macOS·Linux)
pip install -r requirements.txt
cp .env.example .env     # ANTHROPIC_API_KEY 등 채우기
uvicorn app.main:app --reload
pytest                   # SPEC 5장 5케이스 검증
```

### frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

`.env`의 `VITE_RESPONSE_SOURCE`로 응답 소스를 전환한다(SPEC 1장):

- `demo` (기본값): 백엔드 없이 SPEC 5장 시연 케이스 5종을 그대로 재생. 발표·외부 공유용.
- `local`: `VITE_LOCAL_API_BASE_URL`(기본 `http://localhost:8000`)의 실제 백엔드를 호출.
- `remote`: `VITE_REMOTE_API_BASE_URL`의 외부 배포 백엔드를 호출.

## 구현 메모 (SPEC 대비 실제 선택)

- **RAG 로컬 구현**: SPEC 1장은 로컬 RAG를 "FAISS + 한국어 sentence-transformers"로 지정하지만,
  이 저장소의 `backend/app/providers/rag/faiss_provider.py`는 무거운 임베딩 모델 다운로드 없이
  바로 동작하도록 문자 bigram TF-IDF + 코사인 유사도로 같은 인터페이스를 구현했다. 사례가 10건뿐이라
  이 방식으로도 데모 목적은 충분하며, `RagProvider` 인터페이스만 맞추면 실제 임베딩 구현으로
  교체 가능하다.
- **1단계 계좌 신호 중 4개(fund_source/limit_change/device/velocity)**는 SPEC 3-1엔 `customer_id`만
  받는 툴로 정의돼 있지만, 실제로는 "이 이체 시도 시점"의 이벤트 스냅샷이라 `TransferRequest.context_overrides`로
  받는다 — 같은 고객(C001)이 여러 데모 케이스에서 재사용되며 서로 다른 이벤트 상태를 요구하기 때문.
- **개입 강도 임계값**: SPEC 4-4는 등급(저/중/고, 0-29/30-59/60+)으로 개입을 정하지만, SPEC 5장
  케이스3(28점, 저)은 질문 단계까지 가야 하고 케이스4(20점, 저)는 안 가야 한다 — 그래서
  `aggregator.intervention_intensity()`는 원점수 25점을 별도 임계값으로 쓴다(자세한 이유는 해당 함수 주석 참고).

## 테스트

```bash
cd backend && pytest
```

SPEC 5장 5케이스가 각각 선언된 최종 판정(🔴🔴🔴🟢🟢)과 일치하는지, 그리고 RAG 매처가 정상 거래
설명에 오탐하지 않는지 검증한다.
