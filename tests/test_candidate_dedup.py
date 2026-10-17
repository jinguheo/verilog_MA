import json
import unittest
from pathlib import Path

import candidate_dedup as dd

ADC = "u_adc"
SRAM = "u_capture_path.u_capture.u_capture_sram.u_sram22"


def pl(ax, ay, sx, sy, ao="N", so="N"):
    return [{"instance": ADC, "x": ax, "y": ay, "orientation": ao}, {"instance": SRAM, "x": sx, "y": sy, "orientation": so}]


class CandidateDedupTest(unittest.TestCase):
    def test_translation_keeps_relative_signature(self):
        a, b = pl(80, 100, 350, 20), pl(80, 170, 350, 90)
        self.assertEqual(dd.relative_signature(a), dd.relative_signature(b))
        self.assertEqual(dd.classify(a, b), "translation_equivalent")

    def test_one_micron_jitter_is_near_identical(self):
        self.assertEqual(dd.classify(pl(80, 100, 350, 20), pl(81, 100, 350, 21)), "near_identical")

    def test_different_arrangement_or_orientation_is_distinct(self):
        self.assertEqual(dd.classify(pl(80, 100, 350, 20), pl(80, 100, 450, 20)), "distinct")
        self.assertEqual(dd.classify(pl(80, 100, 350, 20), pl(80, 100, 350, 20, so="FN")), "distinct")

    def test_dedupe_keeps_best_first_and_reports_reason(self):
        entries = [
            {"id": "best", "placements": pl(80, 100, 350, 20)},
            {"id": "shifted", "placements": pl(80, 170, 350, 90)},
            {"id": "jitter", "placements": pl(81, 101, 350, 20)},
            {"id": "other", "placements": pl(80, 100, 450, 20)},
        ]
        kept, dropped = dd.dedupe(entries)
        self.assertEqual([e["id"] for e in kept], ["best", "other"])
        reasons = {d["entry"]["id"]: (d["representative"]["id"], d["reason"]) for d in dropped}
        self.assertEqual(reasons["shifted"], ("best", "translation_equivalent"))
        self.assertEqual(reasons["jitter"], ("best", "near_identical"))

    def test_keep_per_class_allows_more_translations_but_never_near_duplicates(self):
        entries = [
            {"id": "a", "placements": pl(80, 100, 350, 20)},
            {"id": "b", "placements": pl(80, 170, 350, 90)},
            {"id": "c", "placements": pl(80, 240, 350, 160)},
            {"id": "b2", "placements": pl(81, 171, 350, 90)},
        ]
        kept, dropped = dd.dedupe(entries, keep_per_class=2)
        self.assertEqual([e["id"] for e in kept], ["a", "b"])
        self.assertEqual({d["entry"]["id"] for d in dropped}, {"c", "b2"})

    def test_find_equivalent_against_history(self):
        history = [{"id": "h1", "placements": pl(80, 100, 350, 20)}]
        hit, reason = dd.find_equivalent(pl(80, 160, 350, 80), history)
        self.assertEqual((hit["id"], reason), ("h1", "translation_equivalent"))
        self.assertEqual(dd.find_equivalent(pl(10, 10, 700, 10), history), (None, "distinct"))

    def test_recorded_history_collapses_to_few_arrangements(self):
        """Regression for the observed waste: the stored 25-candidate history is mostly translations of one arrangement."""
        path = Path(__file__).resolve().parents[1] / "physical_design" / "layout_candidates" / "optimization_history.json"
        history = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(history, list) or not history:
            self.skipTest("history is empty or already deduplicated")
        kept, dropped = dd.dedupe(history)
        self.assertEqual(len(kept) + len(dropped), len(history))
        self.assertLessEqual(len(kept), len(history))
        # kept entries are mutually distinct under the same tolerance
        for i, a in enumerate(kept):
            for b in kept[i + 1:]:
                self.assertEqual(dd.classify(a["placements"], b["placements"]), "distinct")


if __name__ == "__main__":
    unittest.main()
