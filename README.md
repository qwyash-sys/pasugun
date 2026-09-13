# 파수꾼(Pasugun)

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

- **RAG 로컬 구현**: SPEC 1장이 지정한 그대로 `jhgan/ko-sroberta-multitask`(한국어 SBERT) +
  FAISS `IndexFlatIP`로 구현했다(`backend/app/providers/rag/faiss_provider.py`). 모델은 최초
  실행 시 HuggingFace Hub에서 1회 내려받아 로컬 캐시(`~/.cache/huggingface`)에 저장되고, 이후로는
  완전히 오프라인으로 동작한다 — AWS VDI로 옮겨가도 Python 환경만 있으면 별도 AWS 서비스 없이
  동일하게 동작한다. AWS의 관리형 RAG(Bedrock KB + Titan)를 쓰고 싶을 때는 `RAG_BACKEND=bedrock_kb`로
  전환하면 된다(`bedrock_kb_provider.py`, AWS 쪽 Knowledge Base 사전 구성 필요).
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
