# main.py
import telebot
import schedule
import time
import threading
import config
import ai_core
import os
import subprocess

# 텔레그램 봇 초기화
bot = telebot.TeleBot(config.TELEGRAM_TOKEN)

# 텔레그램 코드 블록 기호(백틱 3개)를 안전하게 생성
TICKS = chr(96) * 3

# 1. 정기 보고 발송 작업
def job_send_report():
    print("📢 정기 보고 생성을 시작합니다...")
    try:
        report = ai_core.generate_news_report()
        bot.send_message(config.MY_CHAT_ID, f"📅 [오늘의 에이전트 브리핑]\n\n{report}", parse_mode="Markdown")
        print("✅ 정기 보고 발송 완료!")
    except Exception as e:
        print(f"❌ 보고 생성 중 오류: {e}")

# 매일 오전 8시 30분에 보고 (테스트를 위해 "08:30" 부분을 1~2분 뒤 시간으로 바꿔보세요)
schedule.every().day.at("07:30").do(job_send_report)
schedule.every().day.at("11:00").do(job_send_report)
schedule.every().day.at("17:00").do(job_send_report)
schedule.every().day.at("20:00").do(job_send_report)

def run_scheduler():
    while True:
        schedule.run_pending()
        time.sleep(30)

# 스케줄러를 백그라운드 스레드로 실행
threading.Thread(target=run_scheduler, daemon=True).start()

# 2. 실시간 대화 작업
@bot.message_handler(func=lambda message: True)
def handle_message(message):
    try:
        user_text = message.text

# [수동 트리거] 뉴스 브리핑 즉시 실행
        if any(word in user_text for word in ["브리핑", "뉴스", "보고해"]):
            bot.reply_to(message, "⚡ 명령 확인! 즉시 브리핑을 준비합니다. 잠시만 기다려주세요...")
            job_send_report()
            return

        # [리모컨 1] Control+C (비서 강제 재시작)
        if "control+c" in user_text.lower() or "재시작" in user_text:
            bot.reply_to(message, "⚡ Control+C 수신. 시스템을 종료합니다. (PM2가 즉시 부활시킵니다)")
            os._exit(0)

        # [리모컨 2] 맥북 터미널 원격 조종
        if user_text.startswith("터미널:"):
            if str(message.chat.id) != config.MY_CHAT_ID:
                bot.reply_to(message, "⛔ 권한이 없습니다.")
                return

            cmd = user_text.replace("터미널:", "").strip()
            bot.reply_to(message, f"💻 명령어 실행: `{cmd}`", parse_mode="Markdown")

            try:
                result = subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT, text=True)
                bot.reply_to(message, f"{TICKS}text\n{result[:3900]}\n{TICKS}", parse_mode="Markdown")
            except subprocess.CalledProcessError as e:
                bot.reply_to(message, f"❌ 에러 발생:\n{TICKS}text\n{e.output[:3900]}\n{TICKS}", parse_mode="Markdown")
            return

        # [일반 대화] AI 두뇌 연산
        print(f"\n[입력]: {user_text}")
        answer = ai_core.run_conversation(user_text)
        bot.reply_to(message, answer)
        print(f"[출력]: 완료")

    except Exception as e:
        bot.reply_to(message, f"오류 발생: {e}")

print("🚀 모듈화된 에이전트 가동 중... (종료하려면 Control+C)")
# --- [신규 추가된 부분] 에이전트 기동 시 주인님께 먼저 인사하기 ---
try:
    bot.send_message(config.MY_CHAT_ID, "✨ 삐빅! 안녕하세요. 비서 에이전트가 방금 맥북에서 성공적으로 깨어났습니다. 무엇을 도와드릴까요?")
    print("✅ 기동 완료 인사 발송 성공!")
except Exception as e:
    print(f"❌ 기동 인사 발송 실패 (ID 확인 필요): {e}")


bot.polling(none_stop=True)
