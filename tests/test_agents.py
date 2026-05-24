import unittest

from canvas_copilot.agents import (
    build_flashcards,
    build_quiz,
    build_study_plan,
    build_summary,
    compute_intervention,
)


SAMPLE_TEXT = """
Data pipelines move data from source systems into storage and analytics layers.
Reliable pipelines validate records, retry failed work, and expose monitoring signals.
Students should understand extraction, transformation, loading, orchestration, and testing.
"""


class AgentTests(unittest.TestCase):
    def test_summary_extracts_key_points(self):
        summary = build_summary(SAMPLE_TEXT)
        self.assertTrue(summary["key_points"])
        self.assertIn("pipeline", " ".join(summary["key_terms"]))

    def test_flashcards_and_quiz_are_generated(self):
        flashcards = build_flashcards(SAMPLE_TEXT)
        quiz = build_quiz(SAMPLE_TEXT)
        self.assertTrue(flashcards)
        self.assertTrue(quiz)
        self.assertTrue(quiz[0]["answer"])

    def test_study_plan_has_daily_sessions(self):
        plan = build_study_plan(SAMPLE_TEXT, days=3)
        self.assertEqual(len(plan), 3)
        self.assertTrue(all(item["tasks"] for item in plan))

    def test_intervention_score_uses_scores_and_missing_work(self):
        result = compute_intervention(
            [
                {"points_possible": 100, "score": 65, "missing": False},
                {"points_possible": 50, "score": 30, "missing": True},
            ]
        )
        self.assertGreater(result["score"], 0)
        self.assertIn(result["level"], {"low", "medium", "high"})


if __name__ == "__main__":
    unittest.main()
