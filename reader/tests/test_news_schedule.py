"""news_schedule is pure functions over aware datetimes: windows, staleness, backoff and
fetch windows. Every `now` here is a fixed aware value — no clock, no sleep."""
import unittest
from datetime import datetime, timedelta, timezone

from app import news_schedule as sched
from tests.base import HermeticTestCase

ET = sched.ET


def et(year, month, day, hour=0, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=ET)


# 2026-11-16 is a Monday; 2026-11-13 is a Friday.
class FederalRegisterWindowTests(HermeticTestCase):
    def test_fresh_until_next_business_day_0615(self):
        ok = et(2026, 11, 16, 6, 20)                       # Monday, after the window
        self.assertFalse(sched.is_stale("federal_register", ok, et(2026, 11, 17, 6, 14)))
        self.assertTrue(sched.is_stale("federal_register", ok, et(2026, 11, 17, 6, 15)))

    def test_friday_success_fresh_all_weekend(self):
        ok = et(2026, 11, 13, 6, 20)                       # Friday
        for now in (et(2026, 11, 14, 12, 0), et(2026, 11, 15, 12, 0), et(2026, 11, 16, 6, 14)):
            with self.subTest(now=now):
                self.assertFalse(sched.is_stale("federal_register", ok, now))
        self.assertTrue(sched.is_stale("federal_register", ok, et(2026, 11, 16, 6, 15)))

    def test_latest_window_skips_weekends(self):
        w = sched.latest_window("federal_register", et(2026, 11, 15, 12, 0))  # Sunday
        self.assertEqual(w, et(2026, 11, 13, 6, 15))                          # back to Friday

    def test_next_window_skips_weekends(self):
        w = sched.next_window("federal_register", et(2026, 11, 13, 7, 0))     # Friday 07:00
        self.assertEqual(w, et(2026, 11, 16, 6, 15))                          # Monday

    def test_holidays_are_treated_as_business_days(self):
        # Christmas 2026 falls on a Friday. On purpose, it is still polled: a wrong
        # holiday table would skip real publications, so nobody should add one.
        w = sched.latest_window("federal_register", et(2026, 12, 25, 7, 0))
        self.assertEqual(w, et(2026, 12, 25, 6, 15))

    def test_dst_windows_are_local_wall_clock(self):
        # Monday after the November 2026 change (Nov 2): 06:15 EST == 11:15 UTC.
        nov = sched.latest_window("federal_register", et(2026, 11, 2, 7, 0))
        self.assertEqual(nov.astimezone(timezone.utc),
                         datetime(2026, 11, 2, 11, 15, tzinfo=timezone.utc))
        # A July Monday: 06:15 EDT == 10:15 UTC.
        jul = sched.latest_window("federal_register", et(2026, 7, 6, 7, 0))
        self.assertEqual(jul.astimezone(timezone.utc),
                         datetime(2026, 7, 6, 10, 15, tzinfo=timezone.utc))


class PublicInspectionWindowTests(HermeticTestCase):
    def test_three_windows_in_turn(self):
        ok = et(2026, 11, 16, 9, 5)                        # Monday, after the 09:00 window
        self.assertFalse(sched.is_stale("federal_register_pi", ok, et(2026, 11, 16, 11, 29)))
        self.assertTrue(sched.is_stale("federal_register_pi", ok, et(2026, 11, 16, 11, 30)))
        ok2 = et(2026, 11, 16, 11, 35)
        self.assertFalse(sched.is_stale("federal_register_pi", ok2, et(2026, 11, 16, 16, 29)))
        self.assertTrue(sched.is_stale("federal_register_pi", ok2, et(2026, 11, 16, 16, 30)))

    def test_friday_1631_fresh_until_monday_0900(self):
        ok = et(2026, 11, 13, 16, 31)                      # Friday after the last window
        for now in (et(2026, 11, 14, 12, 0), et(2026, 11, 16, 8, 59)):
            with self.subTest(now=now):
                self.assertFalse(sched.is_stale("federal_register_pi", ok, now))
        self.assertTrue(sched.is_stale("federal_register_pi", ok, et(2026, 11, 16, 9, 0)))


class DolAndCommonTests(HermeticTestCase):
    def test_dol_stale_after_24h_weekends_included(self):
        ok = et(2026, 11, 14, 12, 0)                       # Saturday
        self.assertFalse(sched.is_stale("dol_osha", ok, ok + timedelta(hours=23, minutes=59)))
        self.assertTrue(sched.is_stale("dol_osha", ok, ok + timedelta(hours=24)))

    def test_never_synced_is_always_stale(self):
        now = et(2026, 11, 15, 3, 0)                       # even on a Sunday night
        for source in ("federal_register", "federal_register_pi", "dol_osha"):
            with self.subTest(source=source):
                self.assertTrue(sched.is_stale(source, None, now))

    def test_retry_after_ladder(self):
        err_at = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)
        self.assertIsNone(sched.retry_after(0, err_at))
        self.assertIsNone(sched.retry_after(3, None))
        self.assertEqual(sched.retry_after(1, err_at), err_at + timedelta(minutes=5))
        self.assertEqual(sched.retry_after(2, err_at), err_at + timedelta(minutes=15))
        self.assertEqual(sched.retry_after(3, err_at), err_at + timedelta(hours=1))
        self.assertEqual(sched.retry_after(4, err_at), err_at + timedelta(hours=6))
        self.assertEqual(sched.retry_after(9, err_at), err_at + timedelta(hours=6))

    def test_is_due_respects_backoff(self):
        err_at = datetime(2026, 11, 16, 17, 0, tzinfo=timezone.utc)   # Monday noon ET
        row = {"last_ok_at": None, "last_error_at": err_at, "fail_count": 1}
        self.assertFalse(sched.is_due("federal_register", row, err_at + timedelta(minutes=4)))
        self.assertTrue(sched.is_due("federal_register", row, err_at + timedelta(minutes=6)))

    def test_fr_since(self):
        now = et(2026, 11, 16, 12, 0)
        self.assertEqual(sched.fr_since(None, now, 365), "2025-11-16")
        ok = et(2026, 11, 10, 6, 20)
        self.assertEqual(sched.fr_since(ok, now, 365), "2026-11-07")

    def test_dol_window(self):
        now = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)
        self.assertEqual(sched.dol_window(None, now), (90, 5000, 150))
        self.assertEqual(sched.dol_window(now - timedelta(days=10), now), (30, 1000, 50))
        self.assertEqual(sched.dol_window(now - timedelta(days=45), now), (90, 5000, 150))


if __name__ == "__main__":
    unittest.main()
