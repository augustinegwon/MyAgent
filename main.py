# main.py
import telebot
import schedule
import time
import threading
import config
import ai_core
from agents import planner
import os
import subprocess

# 텔레그램 봇 초기화
bot = telebot.TeleBot(config.TELEGRAM_TOKEN)

# 텔레그램 코드 블록 기호(백틱 3개)를 안전하게 생성
TICKS = chr(96) * 3

# --- [보안 설정] ---
# 터미널 명령에서 차단할 위험 패턴 (소문자 비교)
DANGEROUS_PATTERNS = [
    "rm -rf", "rm -fr", "rm  -rf",
    "mkfs", "dd if=", "dd of=",
    ":(){", "fork()",
    "shutdown", "reboot", "halt", "poweroff",
    "> /dev/sd", "of=/dev/sd",
    "chmod -r 777 /", "chmod 777 /", "chown -r",
    "sudo ", "su -", "su root",
    "passwd ", "userdel", "useradd",
    "/etc/passwd", "/etc/shadow",
    "rm -rf /", "rm -rf ~", "rm -rf *",
]
MAX_CMD_LENGTH = 500
SUBPROCESS_TIMEOUT_SEC = 30

_AGENT_PREFIXES = ("/계획", "/리서치", "/보고")
_BRIEFING_KEYWORDS = ["브리핑", "뉴스", "보고해"]


def is_owner(message):
    """주인 채팅 ID 확인. 타입에 관계없이 안전하게 비교."""
    return str(message.chat.id) == str(config.MY_CHAT_ID)


def is_short_keyword_command(text, keywords):
    """문장 속 우연한 포함이 아닌, 짧은 명령 의도일 때만 True."""
    text = text.strip()
    if text in keywords:
        return True
    if len(text) <= 10 and any(text.startswith(k) for k in keywords):
        return True
    return False


def _is_slash_agent(text):
    """/agent 대소문자 무시, 접두사 뒤에 공백·줄바꿈·끝 이어야 매칭."""
    tl = text.lower()
    return tl.startswith("/agent") and (len(tl) == 6 or tl[6] in (" ", "\n"))


def _is_slash_prefix(text, prefix):
    """정확한 슬래시 prefix 뒤에 공백·줄바꿈·끝이 있을 때만 매칭."""
    return text.startswith(prefix) and (len(text) == len(prefix) or text[len(prefix)] in (" ", "\n"))


def send_long_message(chat_id, text):
    """4000자 초과 메시지를 줄바꿈 경계 기준으로 분할 전송."""
    LIMIT = 4000
    while text:
        if len(text) <= LIMIT:
            bot.send_message(chat_id, text, parse_mode="Markdown")
            break
        split_at = text.rfind("\n", 0, LIMIT)
        if split_at == -1:
            split_at = LIMIT
        bot.send_message(chat_id, text[:split_at], parse_mode="Markdown")
        text = text[split_at:].lstrip("\n")


def is_dangerous_command(cmd):
    low = cmd.lower()
    return any(pat in low for pat in DANGEROUS_PATTERNS)


# 1. 정기 보고 발송 작업
def job_send_report():
    print("📢 정기 보고 생성을 시작합니다...")
    try:
        report = ai_core.generate_news_report()
        bot.send_message(config.MY_CHAT_ID, f"📅 [오늘의 에이전트 브리핑]\n\n{report}", parse_mode="Markdown")
        print("✅ 정기 보고 발송 완료!")
    except Exception as e:
        print(f"❌ 보고 생성 중 오류: {e}")

schedule.every().day.at("07:30").do(job_send_report)
schedule.every().day.at("11:00").do(job_send_report)
schedule.every().day.at("17:00").do(job_send_report)
schedule.every().day.at("20:00").do(job_send_report)

def run_scheduler():
    while True:
        schedule.run_pending()
        time.sleep(30)

threading.Thread(target=run_scheduler, daemon=True).start()


# 2. 실시간 대화 작업
@bot.message_handler(func=lambda message: True)
def handle_message(message):
    try:
        user_text = message.text

        # ① [멀티 에이전트] 슬래시/멘션 명령 — 최우선. 본문에 키워드 포함돼도 무관
        _is_agent_call = (
            _is_slash_agent(user_text)
            or any(_is_slash_prefix(user_text, p) for p in _AGENT_PREFIXES)
            or "@agent" in user_text
        )
        if _is_agent_call:
            if not is_owner(message):
                bot.reply_to(message, "⛔ 권한이 없습니다.")
                return
            clean_text = user_text
            if _is_slash_agent(clean_text):
                clean_text = clean_text[6:].strip()
            else:
                for prefix in _AGENT_PREFIXES:
                    if _is_slash_prefix(clean_text, prefix):
                        clean_text = clean_text[len(prefix):].strip()
                        break
            clean_text = clean_text.replace("@agent", "").strip()
            if not clean_text:
                bot.reply_to(message, "❌ 요청 내용을 입력해주세요.\n예) /agent 강릉 관광 트렌드 분석해줘")
                return
            bot.reply_to(message, "🤖 멀티 에이전트 가동 중... (10~30초 소요)")
            print(f"\n[Planner 요청]: {clean_text}")
            try:
                result = planner.run(clean_text)
                send_long_message(message.chat.id, result)
            except Exception as e:
                print(f"[Planner 오류]: {e}")
                bot.reply_to(message, f"⚠️ 에이전트 처리 중 오류가 발생했습니다: {e}")
            return

        # ② [블로그 분석] 명시적 prefix — 주인 전용
        if user_text.startswith("블로그분석:") or user_text.startswith("블로그 분석:"):
            if not is_owner(message):
                bot.reply_to(message, "⛔ 권한이 없습니다.")
                return
            blog_id = user_text.split(":", 1)[1].strip()
            if not blog_id:
                bot.reply_to(message, "❌ 블로그 ID를 입력해주세요.\n예) 블로그분석: iaxia_z")
                return
            bot.reply_to(message, f"🔍 '{blog_id}' 블로그 인기글 분석 중입니다. 잠시만 기다려주세요... (1~2분 소요)")
            result = ai_core.analyze_naver_blog(blog_id)
            if len(result) > 4000:
                result = result[:4000] + "\n\n(이하 생략)"
            bot.reply_to(message, result)
            return

        # ③ [시스템] 재시작 — 주인 전용
        if "control+c" in user_text.lower() or "재시작" in user_text:
            if not is_owner(message):
                bot.reply_to(message, "⛔ 권한이 없습니다.")
                return
            bot.reply_to(message, "⚡ Control+C 수신. 시스템을 종료합니다. (PM2가 즉시 부활시킵니다)")
            os._exit(0)

        # ④ [터미널] 원격 조종 — 주인 전용 + 위험 명령 차단
        if user_text.startswith("터미널:"):
            if not is_owner(message):
                bot.reply_to(message, "⛔ 권한이 없습니다.")
                return
            cmd = user_text.replace("터미널:", "").strip()
            if not cmd:
                bot.reply_to(message, "❌ 명령어가 비어있습니다.")
                return
            if len(cmd) > MAX_CMD_LENGTH:
                bot.reply_to(message, f"❌ 명령어가 너무 깁니다 (최대 {MAX_CMD_LENGTH}자).")
                return
            if is_dangerous_command(cmd):
                bot.reply_to(message, "⛔ 위험한 명령어로 판단되어 실행을 차단했습니다.")
                return
            bot.reply_to(message, f"💻 명령어 실행: `{cmd}`", parse_mode="Markdown")
            try:
                result = subprocess.check_output(
                    cmd, shell=True, stderr=subprocess.STDOUT,
                    text=True, timeout=SUBPROCESS_TIMEOUT_SEC,
                )
                bot.reply_to(message, f"{TICKS}text\n{result[:3900]}\n{TICKS}", parse_mode="Markdown")
            except subprocess.TimeoutExpired:
                bot.reply_to(message, f"⏱ 시간 초과 ({SUBPROCESS_TIMEOUT_SEC}초). 명령을 종료했습니다.")
            except subprocess.CalledProcessError as e:
                bot.reply_to(message, f"❌ 에러 발생:\n{TICKS}text\n{e.output[:3900]}\n{TICKS}", parse_mode="Markdown")
            return

        # ⑤ [브리핑] 짧은 키워드 명령만 매칭 — 본문 안 우연한 단어는 무시
        if is_short_keyword_command(user_text, _BRIEFING_KEYWORDS):
            if not is_owner(message):
                bot.reply_to(message, "⛔ 권한이 없습니다.")
                return
            bot.reply_to(message, "⚡ 명령 확인! 즉시 브리핑을 준비합니다. 잠시만 기다려주세요...")
            job_send_report()
            return

        # ⑥ [일반 대화] AI 두뇌 연산
        print(f"\n[입력]: {user_text}")
        answer = ai_core.run_conversation(user_text)
        bot.reply_to(message, answer)
        print(f"[출력]: 완료")

    except Exception as e:
        bot.reply_to(message, f"오류 발생: {e}")


if __name__ == "__main__":
    print("🚀 모듈화된 에이전트 가동 중... (종료하려면 Control+C)")
    try:
        bot.send_message(config.MY_CHAT_ID, "✨ 삐빅! 안녕하세요. 비서 에이전트가 방금 맥북에서 성공적으로 깨어났습니다. 무엇을 도와드릴까요?")
        print("✅ 기동 완료 인사 발송 성공!")
    except Exception as e:
        print(f"❌ 기동 인사 발송 실패 (ID 확인 필요): {e}")

    bot.polling(none_stop=True)
