import json
from openai import OpenAI
import config
import tools

# OpenAI 클라이언트 초기화
client = OpenAI(api_key=config.OPENAI_API_KEY)

# --- [도구 명세서] AI에게 능력을 설명하는 부분 ---
ai_tools = [
    {
        "type": "function",
        "function": {
            "name": "get_stock_price",
            "description": "실시간 주식 가격을 가져옵니다. 종목 코드(예: AAPL, TSLA)가 필요합니다.",
            "parameters": {
                "type": "object",
                "properties": {"ticker": {"type": "string"}},
                "required": ["ticker"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "최신 뉴스나 일반적인 지식을 웹에서 검색합니다.",
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
            "description": "네이버 블로그 링크(URL)의 본문 내용을 읽어옵니다.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    }
]

def run_conversation(user_input):
    # 1. AI에게 질문과 도구 목록 전달
    messages = [
        {"role": "system", "content": "너는 나의 유능한 비서다. 주가는 get_stock_price, 최신 정보는 search_web, 네이버 블로그는 read_naver_blog를 사용해라."},
        {"role": "user", "content": user_input}
    ]

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        tools=ai_tools,
        tool_choice="auto"
    )

    response_message = response.choices[0].message
    tool_calls = response_message.tool_calls

    # 2. AI가 도구를 사용하기로 결정한 경우
    if tool_calls:
        # 대화 맥락에 AI의 도구 호출 의사를 추가
        messages.append(response_message)

        for tool_call in tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)

            # 실제 도구 실행 (tools.py 연결)
            if function_name == "get_stock_price":
                function_response = tools.get_stock_price(ticker=function_args.get("ticker"))
            elif function_name == "search_web":
                function_response = tools.search_web(query=function_args.get("query"))
            elif function_name == "read_naver_blog":
                function_response = tools.read_naver_blog(url=function_args.get("url"))
            else:
                function_response = "알 수 없는 도구입니다."

            # 도구 실행 결과를 메시지에 추가
            messages.append({
                "tool_call_id": tool_call.id,
                "role": "tool",
                "name": function_name,
                "content": function_response,
            })

        # 3. 도구 결과를 바탕으로 최종 답변 생성
        second_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
        )
        return second_response.choices[0].message.content

    return response_message.content

def generate_news_report():
    """정기 보고용 함수"""
    search_result = tools.search_web(query="오늘의 주요 IT 기술 및 경제 실시간 뉴스", max_results=10)

    prompt = f"""
    아래 검색 결과를 바탕으로 나에게 가장 도움이 될 만한 핵심 기사 5개를 엄선해줘.
    형식:
    1. [기사 제목](기사 링크)
    - 요약: (기사당 공백 포함 300자 내외로 핵심 내용 요약)

    검색 결과: {search_result}
    """

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "너는 뉴스 큐레이터이자 요약 전문가다. 한국어로 답변해."},
            {"role": "user", "content": prompt}
        ]
    )
    return response.choices[0].message.content
