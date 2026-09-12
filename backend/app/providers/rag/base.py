from typing import Protocol

from app.models import RagMatch


class RagProvider(Protocol):
    def scenario_rag(self, text: str) -> RagMatch: ...
