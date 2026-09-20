import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import analog_optimizer
import analog_runner


class AnalogOptimizerTest(unittest.TestCase):
    def test_catalog_has_analog_and_memory_tracks(self):
        items = {item["id"]: item for item in analog_optimizer.catalog()}
        self.assertIn("sky130_ef_adc3v_12bit", items)
        self.assertIn("openram_sky130", items)
        self.assertIn("sram22_sky130_macros", items)
        self.assertIn("ef_psram_ctrl", items)

    def test_adc_selection_respects_function_and_pdk(self):
        requirements = analog_optimizer.normalize_requirements({"function": "adc", "pdk": "sky130A"})
        ranked = analog_optimizer.rank_candidates(requirements)
        eligible = [item for item in ranked if item["eligible"]]
        self.assertTrue(eligible)
        self.assertIn(eligible[0]["id"], {"sky130_ef_adc3v_12bit", "iic_sky130_adc"})
        self.assertTrue(all(item["ppa"]["status"] == "not_measured" for item in ranked))

    def test_sram_study_separates_macro_and_controller_candidates(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(analog_optimizer, "RUNS_ROOT", Path(directory)):
            study = analog_optimizer.create_study({"function": "sram", "pdk": "sky130A", "capacity_kb": 2})
        kinds = {item["kind"] for item in study["selection"]["candidates"] if item["eligible"]}
        self.assertIn("memory_generator", kinds)
        self.assertIn("digital_controller", kinds)
        self.assertEqual(study["stages"][0]["status"], "complete")
        self.assertEqual(study["stages"][2]["status"], "not_run")

    def test_invalid_function_and_zero_weights_are_rejected(self):
        with self.assertRaises(ValueError):
            analog_optimizer.normalize_requirements({"function": "unknown"})
        with self.assertRaises(ValueError):
            analog_optimizer.normalize_requirements({
                "function": "adc", "performance_weight": 0, "power_weight": 0, "area_weight": 0,
            })

    def test_sram22_artifact_audit_has_integration_views(self):
        candidate = next(item for item in analog_optimizer.catalog() if item["id"] == "sram22_sky130_macros")
        result = analog_runner._artifact_audit(candidate)
        self.assertTrue(result["complete"])
        self.assertGreater(result["views"]["lef"], 0)
        self.assertGreater(result["views"]["lib"], 0)
        self.assertGreater(result["views"]["gds.gz"], 0)
        self.assertIsNotNone(result["area_um2"])

    def test_cace_summary_parser_reads_measured_area(self):
        with tempfile.TemporaryDirectory() as directory:
            summary = Path(directory) / "summary.md"
            summary.write_text(
                "| Area | magic_area | area | | | | | any | 65628.680 µm² | Pass ✅ |\n",
                encoding="utf-8",
            )
            result = analog_runner._parse_cace_summary(summary)
        self.assertEqual(result["metrics"]["area"], 65628.68)
        self.assertEqual(result["statuses"]["Area"], "pass")

    def test_memory_macro_name_parsing(self):
        self.assertEqual(analog_runner._memory_macro_shape("sram22_1024x32m8w8"), (32, 1024))
        self.assertEqual(
            analog_runner._memory_macro_shape("sky130_sram_1kbyte_1rw_32x256_8"),
            (32, 256),
        )
        self.assertEqual(analog_runner._memory_ports("sky130_sram_1kbyte_1rw1r_32x256_8"), 2)

    def test_memory_selector_returns_complete_sram22_views(self):
        candidate = next(item for item in analog_optimizer.catalog() if item["id"] == "sram22_sky130_macros")
        study = {"requirements": {"capacity_kb": 4, "word_width": 32, "ports": 1}}
        with tempfile.TemporaryDirectory() as directory, patch.object(analog_runner, "JOBS_ROOT", Path(directory)):
            result = analog_runner._select_memory_macro({"id": "test-job"}, candidate, study)
        self.assertTrue(result["passed"])
        self.assertEqual(result["selected"]["capacity_kb"], 4)
        self.assertEqual(result["selected"]["width_bits"], 32)
        self.assertIn("gds", result["selected"]["views"])
        self.assertIn("liberty", result["selected"]["views"])

if __name__ == "__main__":
    unittest.main()
