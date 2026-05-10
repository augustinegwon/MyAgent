from openai import OpenAI
import config

client = OpenAI(api_key=config.OPENAI_API_KEY)

MODEL_PLANNER = "gpt-4o"
MODEL_WORKER = "gpt-4o-mini"


def call_llm(system: str, user: str, model: str = MODEL_WORKER, tools=None) -> str:
    try:
        kwargs = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if tools:
            kwargs["tools"] = tools

        response = client.chat.completions.create(**kwargs)
        print(f"[LLM usage] model={model} prompt={response.usage.prompt_tokens} "
              f"completion={response.usage.completion_tokens} total={response.usage.total_tokens}")
        return response.choices[0].message.content
    except Exception as e:
        return f"⚠️ LLM 호출 중 오류가 발생했습니다: {e}"
