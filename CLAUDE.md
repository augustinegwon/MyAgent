# MyAgent — CLAUDE.md

## 프로젝트 개요

macOS에서 PM2로 상시 실행되는 **텔레그램 AI 비서 봇**.
사용자(주인)의 텔레그램 메시지를 받아 OpenAI GPT-4o-mini로 대화하고,
주가 조회·웹 검색·네이버 블로그 읽기 도구를 function calling으로 호출한다.
매일 4회(07:30 / 11:00 / 17:00 / 20:00) IT·경제 뉴스 브리핑을 자동 발송한다.

**현재 브랜치**: `claude/telegram-ai-agent-qnzxK`  
**Python 버전**: 3.10  
**프로세스 관리**: PM2 (`pm2 start main.py --name my_agent`)

---

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `main.py` | 텔레그램 봇 진입점. 메시지 라우팅, 보안 검사, 스케줄러 스레드 실행 |
| `ai_core.py` | OpenAI GPT-4o-mini 호출, function calling 루프, 뉴스 브리핑 생성 |
| `tools.py` | 실제 도구 구현 — 주가(yfinance), 웹검색(Tavily), 네이버 블로그(requests + BS4) |
| `config.py` | API 키 모음 — **절대 커밋 금지**, `.gitignore`에 등록됨 |
| `config.example.py` | 키 없는 템플릿. 새 환경 셋업 시 복사해서 사용 |
| `requirements.txt` | 의존 패키지 목록 |

---

## 보안 규칙

### 1. 주인 권한 확인 (`is_owner`)

모든 민감 명령(브리핑, 재시작, 터미널 조종)은 실행 전에 반드시 `is_owner(message)` 로 검사한다.
주인 판별 기준: `config.MY_CHAT_ID` 와 `message.chat.id` 일치 여부 (문자열 비교).

```python
# main.py:35-37
def is_owner(message):
    return str(message.chat.id) == str(config.MY_CHAT_ID)
```

새 명령 핸들러를 추가할 때는 **항상** `is_owner` 체크를 최우선으로 넣는다.

### 2. 터미널 원격 조종 — 블록리스트 (`DANGEROUS_PATTERNS`)

`터미널:` 접두어 명령은 아래 패턴을 포함하면 즉시 차단된다.

```
rm -rf / rm -fr    mkfs         dd if= / dd of=
:(){  fork()       shutdown / reboot / halt / poweroff
> /dev/sd          chmod -r 777 / chmod 777 / chown -r
sudo  su -  su root   passwd  userdel  useradd
/etc/passwd  /etc/shadow   rm -rf /  rm -rf ~  rm -rf *
```

추가 제약:
- 명령 최대 길이: **500자** (`MAX_CMD_LENGTH`)
- subprocess 타임아웃: **30초** (`SUBPROCESS_TIMEOUT_SEC`)
- `shell=True` 사용 중 — 블록리스트를 우회하는 새 패턴 발견 시 즉시 `DANGEROUS_PATTERNS`에 추가

### 3. config.py 보호

- `config.py`는 `.gitignore`에 등록되어 있어 git에 추적되지 않는다.
- 코드 수정 전 `cp config.py ~/Desktop/myagent_config_backup.py` 로 백업 권장.
- 키를 교체할 경우 `config.example.py`의 키 이름도 함께 업데이트한다.

---

## 배포 방식 (PM2)

### 시작 / 중지 / 재시작

```bash
pm2 start main.py --name my_agent   # 최초 등록
pm2 restart my_agent                 # 코드 변경 후 재시작
pm2 stop my_agent                    # 중지
pm2 delete my_agent                  # 프로세스 제거
```

### 상태 확인 및 로그

```bash
pm2 status                           # 전체 프로세스 상태
pm2 logs my_agent --lines 50         # 최근 로그 50줄
pm2 logs my_agent --err --lines 50   # 에러 로그만
```

### 부팅 시 자동 시작 (초기 1회 설정)

```bash
pm2 startup       # 출력된 명령어 복사 후 실행
pm2 save          # 현재 프로세스 목록 저장
```

### 코드 배포 흐름

```bash
# 1. GitHub에서 최신 코드 pull
git pull origin claude/telegram-ai-agent-qnzxK

# 2. 의존성 변경 시
pip install -r requirements.txt

# 3. 재시작
pm2 restart my_agent

# 4. 정상 기동 확인 (텔레그램으로 "✨ 비서 에이전트가 깨어났습니다" 메시지 수신)
pm2 logs my_agent --lines 20
```

---

## 주요 의존 패키지

```
pyTelegramBotAPI   # 텔레그램 봇 SDK
openai             # GPT-4o-mini API
tavily-python      # 웹 검색 API
yfinance           # 주가 조회
requests           # HTTP 클라이언트
beautifulsoup4     # 네이버 블로그 파싱
schedule           # 정기 보고 스케줄러
```

---

## 주의사항

- **`config.py`를 절대 커밋하지 말 것** — git push 전 `git status`로 반드시 확인.
- 터미널 원격 조종 기능(`터미널:` 명령)은 `shell=True`로 실행되므로 블록리스트 관리에 주의.
- pm2 재시작 횟수(↺)가 급증하면 에러 로그를 먼저 확인할 것.
