"""분석용 가상 인물·계좌·영업점 데이터를 mock_data에 채운다(여러 번 돌려도 같은 결과 — 이미 있으면 건너뜀).

- customers.json: 기존 고객에 프로필(나이·지역)을 붙이고, 통계 분석(지역·나이대)이 의미 있도록 가상 고객을 늘린다.
- payees.json: 정상 수취계좌(오래된 계좌)와 아직 신고되지 않은 신규 사기 계좌, 신고된 사기 계좌 풀을 늘린다.
- branches.json: 영업점 내방 예약 시 자동 배정할 준법감시책임자 명단.

이름·계좌·번호는 모두 가상이다. 실제 인물·계좌와 겹치지 않게 일부러 흔하지 않은 조합을 썼다.

    cd backend && python scripts/seed_mock_people.py
"""

import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "mock_data"

PROFILES = {
    "C001": (34, "서울 강남구"), "C002": (29, "서울 마포구"), "C003": (26, "경기 성남시"), "C004": (52, "서울 서초구"),
    "C005": (61, "부산 해운대구"), "C006": (45, "인천 연수구"), "C007": (38, "대구 수성구"), "C008": (23, "대전 유성구"),
}

# (이름, 나이, 지역, 평균 이체액)
NEW_CUSTOMERS = [
    ("노하윤", 24, "광주 북구", 120000), ("문지후", 27, "서울 관악구", 200000), ("배서아", 33, "경기 수원시", 350000),
    ("송도윤", 36, "경기 용인시", 500000), ("안예준", 42, "울산 남구", 700000), ("조은서", 47, "서울 송파구", 900000),
    ("허태윤", 55, "경북 포항시", 450000), ("류시온", 58, "충남 천안시", 600000), ("권나윤", 53, "경남 창원시", 380000),
    ("신우진", 64, "서울 노원구", 300000), ("홍다은", 67, "전북 전주시", 220000), ("변도하", 69, "부산 사하구", 260000),
    ("마서진", 72, "충북 청주시", 180000), ("곽민서", 75, "강원 춘천시", 150000), ("도유진", 78, "제주 제주시", 200000),
    ("서하람", 31, "경기 고양시", 420000),
]

# (계좌, 은행, 예금주, 개설일수, 신고건수, 풀)  풀: normal(정상·오래된) / scam_new(미신고 신규) / scam_reported(신고된)
NEW_PAYEES = [
    ("356-0412-8819-03", "NH농협은행", "구태현", 1450, 0, "normal"),
    ("821-910345-02-017", "국민은행", "나은서", 980, 0, "normal"),
    ("110-244-901377", "신한은행", "도하린", 2210, 0, "normal"),
    ("1002-455-120934", "우리은행", "라시우", 640, 0, "normal"),
    ("3333-04-7719025", "카카오뱅크", "모예은", 420, 0, "normal"),
    ("100-0412-77310", "토스뱅크", "배건우", 365, 0, "normal"),
    ("301-0192-6644-31", "NH농협은행", "사하준", 3100, 0, "normal"),
    ("585-21-009981", "하나은행", "아윤서", 1850, 0, "normal"),
    ("140-012-558201", "IBK기업은행", "자예린", 760, 0, "normal"),
    ("633-100422-04-005", "국민은행", "차도윤", 2600, 0, "normal"),
    ("1005-702-318845", "우리은행", "(주)대성상사", 4200, 0, "normal"),
    ("352-0330-1187-93", "NH농협은행", "타이준", 530, 0, "normal"),
    ("110-390-228114", "신한은행", "파서윤", 1210, 0, "normal"),
    ("3355-11-204470", "카카오뱅크", "하은찬", 300, 0, "normal"),
    ("302-7741-0095-11", "NH농협은행", "견우진", 2, 0, "scam_new"),
    ("3333-27-1045582", "카카오뱅크", "남궁서", 4, 0, "scam_new"),
    ("100-0988-22145", "토스뱅크", "도현우", 6, 0, "scam_new"),
    ("621-102-558420", "하나은행", "석지안", 9, 0, "scam_new"),
    ("110-451-006892", "신한은행", "가온유", 11, 0, "scam_new"),
    ("1002-902-441170", "우리은행", "방시우", 3, 0, "scam_new"),
    ("3355-08-117702", "카카오뱅크", "탁서후", 14, 1, "scam_reported"),
    ("356-0520-9931-47", "NH농협은행", "빈채원", 19, 2, "scam_reported"),
    ("100-1120-33098", "토스뱅크", "옥하람", 35, 3, "scam_reported"),
    ("824-910112-01-003", "국민은행", "엄지호", 6, 4, "scam_reported"),
]

BRANCHES = [
    ("B001", "양재남지점", "서울 서초구", "한도윤"), ("B002", "강남역지점", "서울 강남구", "채서준"),
    ("B003", "마포중앙지점", "서울 마포구", "봉하윤"), ("B004", "송파지점", "서울 송파구", "여지안"),
    ("B005", "성남분당지점", "경기 성남시", "구민재"), ("B006", "수원영통지점", "경기 수원시", "피서연"),
    ("B007", "인천연수지점", "인천 연수구", "왕도현"), ("B008", "해운대지점", "부산 해운대구", "육하은"),
    ("B009", "수성지점", "대구 수성구", "복시현"), ("B010", "대전둔산지점", "대전 서구", "제나율"),
    ("B011", "광주상무지점", "광주 서구", "연태오"), ("B012", "전주완산지점", "전북 전주시", "추유나"),
]


def dump(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    cpath = DATA / "customers.json"
    customers = json.loads(cpath.read_text(encoding="utf-8"))
    by_id = {c["customer_id"]: c for c in customers}
    for cid, (age, region) in PROFILES.items():
        by_id[cid].setdefault("profile", {"age": age, "region": region})
    for i, (name, age, region, avg) in enumerate(NEW_CUSTOMERS, start=9):
        cid = f"C{i:03d}"
        if cid in by_id:
            continue
        customers.append(
            {
                "customer_id": cid,
                "name": name,
                "phone": f"010-2091-{i:04d}",
                "account": f"351-0091-{i:04d}",
                "balance": 3_000_000 + i * 410_000,
                "baseline": {
                    "avg_transfer_amount": avg,
                    "max_transfer_amount": avg * 4,
                    "usual_hours": [9, 22] if age < 60 else [8, 20],
                    "transfer_limit": 5_000_000 if age < 60 else 3_000_000,
                },
                "recent_transactions": [],
                "recent_events": {"limit_changed": False, "limit_changed_at": None, "fund_source": None, "device_new": False},
                "note": "리포트·통계 분석 이력 전용 가상 고객.",
                "profile": {"age": age, "region": region},
            }
        )
    dump(cpath, customers)

    ppath = DATA / "payees.json"
    payees = json.loads(ppath.read_text(encoding="utf-8"))
    known = {p["payee_account"] for p in payees}
    for p in payees:
        if "리포트 이력" in p.get("note", "") and "pool" not in p:
            p["pool"] = "scam_reported" if p["is_fraud_reported"] else "scam_new"
    for account, bank, name, age, reports, pool in NEW_PAYEES:
        if account in known:
            continue
        payees.append(
            {
                "payee_account": account,
                "payee_bank": bank,
                "payee_name": name,
                "is_fraud_reported": reports > 0,
                "fraud_report_count": reports,
                "account_age_days": age,
                "pool": pool,
                "note": "분석용 가상 수취계좌(" + {"normal": "정상", "scam_new": "미신고 신규 사기", "scam_reported": "신고된 사기"}[pool] + ")",
            }
        )
    dump(ppath, payees)

    dump(
        DATA / "branches.json",
        [
            {"code": code, "name": name, "region": region, "officer": {"name": officer, "title": "준법감시책임자"}}
            for code, name, region, officer in BRANCHES
        ],
    )
    print(f"customers={len(customers)} payees={len(payees)} branches={len(BRANCHES)}")


if __name__ == "__main__":
    main()
