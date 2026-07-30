import argparse
import json
from orchestrator import VeriolgMA


def main():
    parser = argparse.ArgumentParser(description="Veriolg_MA specialized RTL agents")
    parser.add_argument("--requirements", required=True)
    parser.add_argument("--module", default="generated_module")
    parser.add_argument("--knowledge-root", default=r"D:\MyWork\verilog")
    args = parser.parse_args()
    output = VeriolgMA(args.knowledge_root).run({
        "requirements": args.requirements,
        "module_name": args.module,
    })
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
