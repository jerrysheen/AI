import unittest

from src.review_engine.scheduler import ReviewState, apply_review


class SchedulerTests(unittest.TestCase):
    def test_good_answer_increases_interval(self) -> None:
        state = ReviewState()
        updated = apply_review(state, 3)
        self.assertEqual(updated.reps, 1)
        self.assertGreaterEqual(updated.interval_days, 1)

    def test_hard_answer_keeps_short_interval(self) -> None:
        state = ReviewState(reps=1, interval_days=1)
        updated = apply_review(state, 2)
        self.assertLess(updated.interval_days, 2)

    def test_again_answer_creates_relearning_step(self) -> None:
        state = ReviewState(reps=3, interval_days=5)
        updated = apply_review(state, 1)
        self.assertEqual(updated.reps, 0)
        self.assertLess(updated.interval_days, 0.01)


if __name__ == "__main__":
    unittest.main()
