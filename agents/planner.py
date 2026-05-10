import json
from .shared import client, MODEL_PLANNER
from . import researcher, writer

_SYSTEM = """너는 업무 오케스트레이터다. 사용자 요청을 받으면:
1. 작업을 단계별로 분해 (먼저 한국어로 계획을 명시)
2. research / write 도구를 적절히 호출 (필요시 순차 호출)
3. 결과를 종합해 최종 한국어 답변 작성
원칙:
- 단순 질문이면 도구 호출 없이 바로 답해도 됨
- 도구 호출은 신중히 (각 호출이 시간·비용 소모)
- 최종 답변은 텔레그램에 적합하게 (4000자 이내, 마크다운 OK)"""

_TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "research",
            "description": "주어진 주제를 웹 검색으로 조사해 raw 자료를 반환합니다.",
            "parameters": {
                "type": "object",
                "properties": {"topic": {"type": "string", "description": "조사할 주제"}},
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write",
            "description": "raw 자료를 텔레그램 형식 한국어 보고서로 가공합니다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "raw_content": {"type": "string", "description": "가공할 원자료"},
                    "tone": {
                        "type": "string",
                        "description": "톤: 비서 / 코칭 / 마케팅",
                        "enum": ["비서", "코칭", "마케팅"],
                    },
                },
                "required": ["raw_content"],
            },
        },
    },
]


def run(user_request: str, max_iterations: int = 5) -> str:
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user_request},
    ]
    total_tokens = 0

    for iteration in range(max_iterations):
        response = client.chat.completions.create(
            model=MODEL_PLANNER,
            messages=messages,
            tools=_TOOL_SPECS,
            tool_choice="auto",
        )
        total_tokens += response.usage.total_tokens
        print(f"[Planner iter={iteration+1}] prompt={response.usage.prompt_tokens} "
              f"completion={response.usage.completion_tokens} total_so_far={total_tokens}")

        msg = response.choices[0].message
        tool_calls = msg.tool_calls

        if not tool_calls:
            print(f"[Planner] 완료. 총 토큰={total_tokens}")
            return msg.content or "⚠️ Planner가 빈 결과를 반환했습니다."

        messages.append(msg)

        for tc in tool_calls:
            fn = tc.function.name
            args = json.loads(tc.function.arguments)
            print(f"[Planner] 도구 호출: {fn}({args})")

            if fn == "research":
                result = researcher.research(topic=args.get("topic", ""))
            elif fn == "write":
                raw = args.get("raw_content", "")
                if not raw:
                    result = "⚠️ raw_content가 비어있습니다. 먼저 research를 호출해 자료를 수집하세요."
                else:
                    result = writer.write(raw_content=raw, tone=args.get("tone", "비서"))
            else:
                result = f"알 수 없는 도구: {fn}"

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "name": fn,
                "content": result,
            })

    print(f"[Planner] max_iterations({max_iterations}) 도달, 최종 정리 요청")
    messages.append({"role": "user", "content": "지금까지 수집·작성한 내용을 최종 답변으로 정리해줘."})
    response = client.chat.completions.create(model=MODEL_PLANNER, messages=messages)
    total_tokens += response.usage.total_tokens
    print(f"[Planner final] total_tokens={total_tokens}")
    return response.choices[0].message.content or "⚠️ Planner 최종 정리 실패"
