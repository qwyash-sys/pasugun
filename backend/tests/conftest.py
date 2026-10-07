"""테스트 공통: 룰 설정은 프로세스 전역이라, 한 테스트가 바꾼 임계치가 다음 테스트로 새지 않게 매번 초기화한다."""

import pytest

from app.rule_config import reset_rule_config


@pytest.fixture(autouse=True)
def _fresh_rule_config():
    reset_rule_config()
    yield
    reset_rule_config()
