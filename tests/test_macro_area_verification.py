import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import macro_area_verification as verification


def candidate():
    return {
        "id": "C0001",
        "die": {"w": 3700, "h": 2100},
        "macros": [{"x": 100 + i * 900, "y": 100 + j * 1100} for j in range(2) for i in range(4)],
    }


class MacroAreaVerificationTests(unittest.TestCase):
    def test_rejects_overlap_and_missing_macro(self):
        item = candidate()
        item["macros"][1]["x"] = 100
        with self.assertRaisesRegex(ValueError, "overlapping"):
            verification._check_candidate(item)
        item["macros"].pop()
        with self.assertRaisesRegex(ValueError, "eight"):
            verification._check_candidate(item)

    def test_candidate_config_keeps_physical_views_and_updates_coordinates(self):
        with tempfile.TemporaryDirectory() as folder:
            design_dir = Path(folder)
            source = design_dir / "config_hierarchical.json"
            source.write_text(json.dumps({"DESIGN_NAME": "daq_subsystem", "DIE_AREA": [0, 0, 3700, 2100],
                "MACROS": {"chan_top": {"gds": ["dir::chan_top.gds"], "lef": ["dir::chan_top.lef"],
                    "instances": {}}}}), encoding="utf-8")
            with patch.object(verification, "DESIGN_DIR", design_dir), patch.object(verification, "SOURCE_CONFIG", source):
                path = verification._config_for("abcdef123456", 0, verification._check_candidate(candidate()), 0.4)
            result = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(result["MACROS"]["chan_top"]["gds"], ["dir::chan_top.gds"])
            self.assertEqual(result["MACROS"]["chan_top"]["instances"]["gen_chan[7].u_chan_top"]["location"], [2800, 1200])
            self.assertEqual(result["PL_TARGET_DENSITY_PCT"], 40)


if __name__ == "__main__":
    unittest.main()
