import json
from .shared import client, MODEL_WORKER
import tools

_SYSTEM = """너는 정보 수집 전문가다. 주어진 주제에 대해:
1. 핵심 쟁점 2~3개를 식별
2. 각 쟁점에 대해 search_web 도구로 검색 (최대 3회 호출)
3. 필요시 read_naver_blog로 본문 추가 수집
4. 사실 기반으로 정리한 raw 자료를 출력 (요약 금지, Writer가 별도로 가공함)
추측·의견·창작 금지. 출처 URL은 반드시 포함."""

_TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "최신 정보를 웹에서 검색합니다.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_naver_blog",
            "description": "네이버 블로그 URL의 본문을 읽어옵니다.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
]


def research(topic: str, max_iterations: int = 3) -> str:
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": f"다음 주제를 조사해줘: {topic}"},
    ]
    total_tokens = 0

    for iteration in range(max_iterations):
        response = client.chat.completions.create(
            model=MODEL_WORKER,
            messages=messages,
            tools=_TOOL_SPECS,
            tool_choice="auto",
        )
        total_tokens += response.usage.total_tokens
        print(f"[Researcher iter={iteration+1}] prompt={response.usage.prompt_tokens} "
              f"completion={response.usage.completion_tokens} total_so_far={total_tokens}")

        msg = response.choices[0].message
        tool_calls = msg.tool_calls

        if not tool_calls:
            # LLM이 도구 없이 최종 텍스트 반환 → 루프 종료
            return msg.content or "⚠️ Researcher가 빈 결과를 반환했습니다."

        messages.append(msg)

        for tc in tool_calls:
            fn = tc.function.name
            args = json.loads(tc.function.arguments)

            if fn == "search_web":
                result = tools.search_web(query=args.get("query", ""))
            elif fn == "read_naver_blog":
                result = tools.read_naver_blog(url=args.get("url", ""))
            else:
                result = f"알 수 없는 도구: {fn}"

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "name": fn,
                "content": result,
            })

    # max_iterations 소진 → 지금까지 수집된 내용으로 최종 정리 요청
    print(f"[Researcher] max_iterations({max_iterations}) 도달, 최종 정리 요청")
    messages.append({"role": "user", "content": "지금까지 수집한 내용을 출처 URL 포함해서 raw 자료로 정리해줘."})
    response = client.chat.completions.create(model=MODEL_WORKER, messages=messages)
    total_tokens += response.usage.total_tokens
    print(f"[Researcher final] total_tokens={total_tokens}")
    return response.choices[0].message.content or "⚠️ Researcher 최종 정리 실패"
