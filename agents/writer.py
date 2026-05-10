from .shared import call_llm, MODEL_WORKER

_SYSTEM_BASE = """너는 한국어 보고서 작성 전문가다.
주어진 원자료(raw)를 받아 텔레그램에 적합한 형태로 가공한다.
- 굵기(**텍스트**)와 이모지를 적절히 사용
- 핵심 먼저, 디테일 나중
- 4000자 이내 (텔레그램 한계)
- 마크다운 사용 가능
톤: {tone}"""

TONE_GUIDE = {
    "비서": "친절하고 간결한 비서 톤. 사실 중심으로 요약.",
    "코칭": "따뜻하고 동기부여적인 코칭 톤. 인사이트와 질문을 곁들인다.",
    "마케팅": "흥미롭고 설득력 있는 마케팅 톤. 독자의 행동을 유도한다.",
}


def write(raw_content: str, tone: str = "비서") -> str:
    tone_desc = TONE_GUIDE.get(tone, tone)
    system = _SYSTEM_BASE.format(tone=tone_desc)
    return call_llm(system=system, user=raw_content, model=MODEL_WORKER)
