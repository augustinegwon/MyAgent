# MyAgent — CLAUDE.md

## 프로젝트 개요

macOS에서 PM2로 상시 실행되는 텔레그램 AI 비서 봇.
**OpenAI GPT-4o-mini** + function calling으로 주가 조회·웹 검색·네이버 블로그 읽기를 수행하고, 하루 4회 뉴스 브리핑을 자동 발송한다.

---

## 파일별 역할

| 파일 | 역할 |
|------|------|
| `main.py` | 봇 진입점. 메시지 라우팅, 보안 검사, 스케줄러 스레드 |
| `ai_core.py` | OpenAI 호출, function calling 루프, 뉴스 브리핑 생성 |
| `tools.py` | 도구 구현 — 주가(yfinance), 웹검색(Tavily), 네이버 블로그(BS4) |
| `config.py` | API 키 — **커밋 금지** (`.gitignore` 등록됨) |
| `config.example.py` | 키 없는 템플릿. 신규 환경 셋업 시 복사해서 사용 |
| `requirements.txt` | 의존 패키지 목록 |

---

## 보안 규칙

**① 주인 인증** — 모든 민감 명령 실행 전 반드시 확인

```python
def is_owner(message):
    return str(message.chat.id) == str(config.MY_CHAT_ID)
```

새 명령 핸들러 추가 시 `is_owner` 체크를 첫 줄에 넣는다.

**② 터미널 명령 블록리스트** (`DANGEROUS_PATTERNS`, `main.py:19-30`)

차단 패턴: `rm -rf`, `mkfs`, `dd if=`, `:(){`, `shutdown`, `reboot`,
`sudo`, `su -`, `passwd`, `/etc/passwd`, `/etc/shadow` 등.

**③ 추가 제약**

- 명령 최대 길이: 500자 (`MAX_CMD_LENGTH`)
- subprocess 타임아웃: 30초 (`SUBPROCESS_TIMEOUT_SEC`)
- HTTP 요청 타임아웃: 10초 (`REQUEST_TIMEOUT` in `tools.py`)

---

## 배포 방식 (PM2)

```bash
pm2 restart my_agent          # 코드 변경 후 재시작
pm2 status                    # 상태 확인
pm2 logs my_agent --lines 50  # 로그 확인
```

코드 배포 흐름:
```bash
git pull origin claude/telegram-ai-agent-qnzxK
pip install -r requirements.txt   # 의존성 변경 시만
pm2 restart my_agent
```

---

## 코드 컨벤션

- **AI 백엔드는 OpenAI 전용** (`openai` 패키지, `gpt-4o-mini`). Gemini·Claude 등 다른 제공자로 교체하지 않는다.
- 새 도구는 `tools.py`에 함수로 추가 → `ai_core.py`의 `ai_tools` 명세와 `run_conversation` 분기에 등록.
- API 키는 항상 `config.py`에서만 읽는다. 하드코딩 금지.
- 한국어 출력 메시지는 기존 이모지 스타일(✅ ❌ ⛔ 💻)을 유지한다.

---

## 변경 후 검증 순서

1. `python3 -m py_compile <변경파일>.py` — 문법 오류 확인
2. `pm2 restart my_agent` — 재시작
3. `pm2 logs my_agent --lines 20` — 기동 인사 수신 및 에러 없음 확인
4. 텔레그램에서 실제 메시지 전송으로 동작 검증

---

## 알려진 한계

- **대화 히스토리 없음** — 매 메시지가 독립적. 이전 대화 문맥을 이어받지 못한다.
- **단일 사용자 전용** — `MY_CHAT_ID` 한 명만 주인으로 인정.
- **터미널 조종 `shell=True`** — 블록리스트 우회 가능성 상존. 신뢰하지 않는 입력 주의.
- **스케줄러 드리프트** — PM2 재시작 시 다음 정각 실행까지 대기 (누락 없음, 단 즉시 재실행 안 됨).
