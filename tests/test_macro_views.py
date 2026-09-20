import tempfile
import unittest
from pathlib import Path

from tools.validate_macro_views import compare_views


class MacroViewValidationTest(unittest.TestCase):
    def test_matching_bus_and_scalar_pins(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lef = root / "macro.lef"
            verilog = root / "macro.v"
            spice = root / "macro.spice"
            lef.write_text(
                "MACRO demo\n PIN data[0]\n END data[0]\n"
                " PIN data[1]\n END data[1]\n PIN vdd\n END vdd\nEND demo\n"
            )
            verilog.write_text(
                "module demo(input wire [1:0] data, inout wire vdd); endmodule\n"
            )
            spice.write_text(".subckt demo data[0] data[1] vdd\n.ends demo\n")

            report = compare_views("demo", lef, verilog, spice)

        self.assertTrue(report["valid"])
        self.assertEqual(report["pin_count"], 3)

    def test_reports_cross_view_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lef = root / "macro.lef"
            verilog = root / "macro.v"
            spice = root / "macro.spice"
            lef.write_text(
                "MACRO demo\n PIN a\n END a\n PIN y\n END y\nEND demo\n"
            )
            verilog.write_text(
                "module demo(input wire a, output wire wrong); endmodule\n"
            )
            spice.write_text(".subckt demo a y\n.ends demo\n")

            report = compare_views("demo", lef, verilog, spice)

        self.assertFalse(report["valid"])
        self.assertEqual(report["mismatches"]["verilog"]["missing"], ["y"])
        self.assertEqual(report["mismatches"]["verilog"]["extra"], ["wrong"])


if __name__ == "__main__":
    unittest.main()
