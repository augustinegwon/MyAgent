"""
main.py 핸들러 라우팅 단위 테스트.

핵심 패치 전략:
  @bot.message_handler(...) 데코레이터가 handle_message를 MagicMock으로
  덮어쓰지 않도록, TeleBot 인스턴스의 message_handler를 항등 데코레이터로
  교체한 뒤 main을 import 한다.
"""
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

# ── 외부 의존 모듈 stub ──────────────────────────────────────────────────────
_mock_config = MagicMock()
_mock_config.MY_CHAT_ID = "OWNER"
_mock_config.TELEGRAM_TOKEN = "FAKE"

# message_handler 데코레이터가 함수를 그대로 반환하도록 설정
_mock_bot_instance = MagicMock()
_mock_bot_instance.message_handler = lambda **kwargs: (lambda func: func)

_mock_telebot = MagicMock()
_mock_telebot.TeleBot.return_value = _mock_bot_instance

sys.modules["telebot"] = _mock_telebot
sys.modules["config"] = _mock_config
sys.modules["ai_core"] = MagicMock()
sys.modules["agents"] = MagicMock()
sys.modules["agents.planner"] = MagicMock()

import main  # noqa: E402  (must come after sys.modules patching)


# ── 공통 헬퍼 ────────────────────────────────────────────────────────────────
def msg(text, chat_id="OWNER"):
    """chat.id와 text만 있는 최소 message 객체."""
    m = types.SimpleNamespace()
    m.text = text
    m.chat = types.SimpleNamespace(id=chat_id)
    return m


# ── 헬퍼 함수 독립 테스트 ─────────────────────────────────────────────────────
class TestIsShortKeywordCommand(unittest.TestCase):
    KW = ["브리핑", "뉴스", "보고해"]

    def ok(self, text):
        self.assertTrue(main.is_short_keyword_command(text, self.KW), repr(text))

    def no(self, text):
        self.assertFalse(main.is_short_keyword_command(text, self.KW), repr(text))

    def test_exact(self):
        self.ok("브리핑"); self.ok("뉴스"); self.ok("보고해")

    def test_short_prefix(self):
        self.ok("뉴스 보여줘")   # 7자
        self.ok("브리핑해줘")    # 6자

    def test_long_sentence_ignored(self):
        self.no("오늘 뉴스 보다가 좋은 거 있어서 공유해")
        self.no("/agent 강릉 마케팅 브리핑 짜줘")
        self.no("어제 브리핑 내용 기억해?")


class TestSlashAgentHelper(unittest.TestCase):
    def test_lowercase(self):
        self.assertTrue(main._is_slash_agent("/agent 뭔가"))

    def test_uppercase(self):
        self.assertTrue(main._is_slash_agent("/AGENT 뭔가"))

    def test_no_space_not_matched(self):
        self.assertFalse(main._is_slash_agent("/agent뭔가"))

    def test_standalone(self):
        self.assertTrue(main._is_slash_agent("/agent"))

    def test_newline(self):
        self.assertTrue(main._is_slash_agent("/agent\n내용"))


# ── handle_message 라우팅 테스트 ─────────────────────────────────────────────
class TestRouting(unittest.TestCase):
    def setUp(self):
        self.p_bot      = patch.object(main, "bot", _mock_bot_instance)
        self.p_report   = patch.object(main, "job_send_report", MagicMock())
        self.p_planner  = patch.object(main, "planner", MagicMock())
        self.p_conv     = patch.object(main.ai_core, "run_conversation", MagicMock(return_value="AI답변"))
        self.p_exit     = patch.object(main.os, "_exit", MagicMock())

        self.bot     = self.p_bot.start()
        self.report  = self.p_report.start()
        self.planner = self.p_planner.start()
        self.conv    = self.p_conv.start()
        self.exit    = self.p_exit.start()

        # 각 테스트 전 호출 기록 초기화
        self.bot.reset_mock()
        self.report.reset_mock()
        self.planner.reset_mock()
        self.conv.reset_mock()
        self.exit.reset_mock()

    def tearDown(self):
        self.p_bot.stop()
        self.p_report.stop()
        self.p_planner.stop()
        self.p_conv.stop()
        self.p_exit.stop()

    # ── Planner 분기 ──────────────────────────────────────────────────────────
    def test_agent_ignores_briefing_in_body(self):
        """/agent 본문에 '브리핑'이 있어도 Planner를 호출해야 한다."""
        main.handle_message(msg("/agent 강릉 마케팅 브리핑 짜줘"))
        self.planner.run.assert_called_once()
        self.report.assert_not_called()

    def test_agent_ignores_news_in_body(self):
        """/agent 다음에 '뉴스'가 있어도 Planner를 호출해야 한다."""
        main.handle_message(msg("/agent 어제 뉴스 정리해줘"))
        self.planner.run.assert_called_once()
        self.report.assert_not_called()

    def test_agent_empty_body_replies_error(self):
        """/agent만 보내면 ❌ 에러 안내를 reply 해야 한다."""
        main.handle_message(msg("/agent"))
        self.planner.run.assert_not_called()
        self.bot.reply_to.assert_called()
        self.assertIn("❌", self.bot.reply_to.call_args[0][1])

    def test_at_agent_mention(self):
        """"@agent" 포함 메시지는 Planner를 호출해야 한다."""
        main.handle_message(msg("@agent 코칭 톤으로 정리해줘"))
        self.planner.run.assert_called_once()

    def test_non_owner_agent_blocked(self):
        """주인 아닌 사용자의 /agent 호출은 ⛔ 메시지로 차단해야 한다."""
        main.handle_message(msg("/agent 뭔가", chat_id="STRANGER"))
        self.planner.run.assert_not_called()
        self.bot.reply_to.assert_called()
        self.assertIn("⛔", self.bot.reply_to.call_args[0][1])

    # ── 브리핑 분기 ──────────────────────────────────────────────────────────
    def test_briefing_exact(self):
        """"브리핑" 단독 메시지는 뉴스 브리핑을 실행해야 한다."""
        main.handle_message(msg("브리핑"))
        self.report.assert_called_once()
        self.planner.run.assert_not_called()

    def test_news_short_command(self):
        """"뉴스 보여줘" (10자 이내)는 뉴스 브리핑을 실행해야 한다."""
        main.handle_message(msg("뉴스 보여줘"))
        self.report.assert_called_once()

    def test_news_long_sentence_passes_to_ai(self):
        """"뉴스"가 긴 문장 안에 있으면 일반 대화로 가야 한다."""
        main.handle_message(msg("오늘 뉴스 보다가 좋은 거 있어서 공유해"))
        self.conv.assert_called_once()
        self.report.assert_not_called()

    # ── 시스템 명령 ───────────────────────────────────────────────────────────
    def test_restart_command(self):
        """"재시작" 메시지는 os._exit(0)을 호출해야 한다."""
        main.handle_message(msg("재시작"))
        self.exit.assert_called_once_with(0)

    # ── 일반 대화 ─────────────────────────────────────────────────────────────
    def test_normal_chat(self):
        """"안녕" 같은 일반 메시지는 run_conversation으로 가야 한다."""
        main.handle_message(msg("안녕"))
        self.conv.assert_called_once_with("안녕")
        self.planner.run.assert_not_called()
        self.report.assert_not_called()


if __name__ == "__main__":
    unittest.main()
