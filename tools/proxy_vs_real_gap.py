"""Proxy-vs-real gap report: which cheap indicators agree with what the real flow later did?

    python tools/proxy_vs_real_gap.py            # writes docs/proxy-vs-real-gap.md and physical_design/layout_candidates/proxy_gap.json

Part A uses OUR data: the real daq_subsystem OpenLane outcomes in failure_knowledge.json against placement-derived indicators computed here,
plus the model-reported indicators that exist only in NEXT_SESSION.md notes (clearly marked). Part B reproduces, from the numeric tables of the
EXPlace paper (ICLR 2026, Tables 2 and 3), how well cheap metrics predict later metrics across methods. Part B is outside evidence, not ours.
Nothing here runs OpenLane.
"""
from __future__ import annotations

import json
import statistics as st
import sys
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import candidate_dedup as dd  # noqa: E402
import failure_knowledge as fk  # noqa: E402

DOC = ROOT / "docs" / "proxy-vs-real-gap.md"
OUT = ROOT / "physical_design" / "layout_candidates" / "proxy_gap.json"
HISTORY = ROOT / "physical_design" / "layout_candidates" / "optimization_history.json"
ARCHIVE = ROOT / "physical_design" / "layout_candidates" / "optimization_history_duplicates.json"


# ------------------------------------------------------------------------------------------------------------------- Part A
def center(m):
    return (m["x"] + m["w"] / 2, m["y"] + m["h"] / 2)


def indicators(placements):
    macros = fk.macros_from_placements(placements)
    cs = [center(m) for m in macros]
    pair = [abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in combinations(cs, 2)]
    xs0, ys0 = min(m["x"] for m in macros), min(m["y"] for m in macros)
    xs1, ys1 = max(m["x"] + m["w"] for m in macros), max(m["y"] + m["h"] for m in macros)
    return {
        "mean_pairwise_manhattan_um": round(st.mean(pair), 1),
        "macro_bbox_um": [round(xs1 - xs0, 1), round(ys1 - ys0, 1)],
        **{k: v for k, v in fk.daq_features(placements).items() if k in ("row_channel_um", "topology")},
    }


def part_a() -> dict:
    db = fk.load_db()
    rows = []
    for r in db["records"]:
        rows.append({
            "id": r["id"], "status": r["status"], "usable_as_label": r["usable_as_label"], "last_stage": r["last_stage"],
            "error_codes": r["error_codes"], "stage_outcomes": r["stage_outcomes"], "indicators": indicators(r["placement"]),
            "notes_only": r["evidence"]["notes_only"],
        })
    # what the three usable labels can and cannot say, per failure type
    by = {r["id"]: r for r in rows}
    base, v1, v2 = by["daq-grid-baseline-20260924"], by["daq-macrotetris-v1-20260925"], by["daq-macrotetris-v2-20260926"]
    hold_labels = [("pass", base), ("fail", v1), ("pass", v2)]       # ResizerTimingPostCTS reached by all three
    route_labels = [("pass", base), ("fail", v2)]                    # GlobalRouting reached only by baseline and v2
    return {"records": rows,
            "hold_repair_stage": {"labels": [(lab, r["id"]) for lab, r in hold_labels], "n": len(hold_labels)},
            "global_route_stage": {"labels": [(lab, r["id"]) for lab, r in route_labels], "n": len(route_labels)}}


def history_stats() -> dict:
    hist = json.loads(HISTORY.read_text(encoding="utf-8"))
    arch = json.loads(ARCHIVE.read_text(encoding="utf-8")) if ARCHIVE.exists() else []
    entries = [*hist, *[a["entry"] for a in arch]]
    rel = {dd.relative_signature(e["placements"]) for e in entries}
    est = {e["metrics"]["candidate"]["estimated_routing_length_um"] for e in entries}
    return {"candidates_ever_recorded": len(entries), "distinct_exact_placements": len({e["signature"] for e in entries}),
            "distinct_relative_arrangements_exact_mm": len(rel), "distinct_estimate_values": len(est),
            "physically_verified": sum(1 for e in entries if e.get("verification")), "kept_after_dedup": len(hist)}


# ------------------------------------------------------------------------------------------------------------------- Part B
def rank(v):
    s = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and v[s[j + 1]] == v[s[i]]:
            j += 1
        for k in range(i, j + 1):
            r[s[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = rank(a), rank(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** 0.5
    return num / den if den else float("nan")


# EXPlace Table 2 (ICCAD 2015; 5 methods x 8 designs; WNS/TNS as magnitudes) and Table 3 (OpenROAD, 6 methods x 6 designs). Lower is better.
ICCAD = {
    "rWL": [[159, 199, 140, 167, 220, 244, 136, 53.3], [121, 149, 87.3, 142, 186, 225, 102, 58.5], [139, 175, 105, 172, 214, 212, 115, 63.8], [117, 103.1, 95.3, 131, 189, 210, 100, 58.3], [108, 134, 77.5, 138, 171, 195, 90.2, 55.8]],
    "WNS": [[111, 108, 106, 71.7, 59.6, 240, 65.5, 30.3], [66.4, 135, 63.0, 127, 70.4, 67.3, 42.9, 32.5], [77.4, 102, 71.9, 169, 93.0, 67.8, 50.2, 35.3], [47.2, 76.2, 46.6, 117, 59.8, 69.9, 37.2, 29.6], [58.6, 82.3, 34.1, 111, 41.8, 71.6, 21.4, 25.3]],
    "TNS": [[37.3, 25.1, 21.8, 17.4, 13.7, 41.0, 21.0, 1.78], [12.3, 17.4, 11.5, 11.6, 18.1, 28.1, 14.7, 1.95], [31.5, 22.7, 16.9, 22.1, 24.4, 35.2, 25.5, 10.4], [12.9, 3.49, 10.7, 10.8, 12.0, 33.0, 15.3, 3.60], [8.63, 7.80, 6.65, 8.96, 9.13, 20.9, 5.29, 1.32]],
}
OPENROAD = {
    "rWL": [[7.13, 8.11, 9.50, 2.97, 2.07, 4.91], [7.59, 7.85, 9.81, 3.06, 2.24, 5.50], [7.21, 7.80, 10.94, 2.63, 2.21, 5.52], [8.57, 8.83, 10.17, 3.40, 2.26, 5.25], [7.96, 8.10, 10.55, 2.91, 2.13, 4.39], [7.92, 7.99, 8.91, 2.68, 1.96, 4.51]],
    "WNS": [[1.33, 1.28, 4.71, 1.12, .82, .73], [1.13, 1.19, 4.63, 1.24, .52, .72], [1.28, 1.32, 4.66, 1.06, .53, 1.43], [1.06, 1.14, 4.76, 1.16, .49, .66], [1.04, 1.18, 4.84, 1.36, .53, .76], [1.07, 1.08, 4.66, 1.11, .49, .57]],
    "TNS": [[3640.33, 3517.62, 129.52, 230.09, 88.98, 698.98], [2892.99, 3085.98, 918.45, 382.62, 113.74, 649.06], [3760.32, 3713.91, 142.35, 226.37, 90.62, 1410.02], [2877.32, 3003.30, 56.41, 262.01, 90.79, 506.76], [2758.19, 3030.05, 329.68, 360.87, 97.90, 547.59], [2711.80, 2834.88, 50.09, 257.73, 77.33, 458.80]],
    "DRC": [[18, 26, 274, 269, 79, 2871], [6, 10, 458, 2400, 273, 4841], [20, 131, 13435, 100, 1255, 1131], [9, 54, 74, 9011, 5581, 2980], [602, 9, 4692, 395, 3721, 1096], [8, 8, 49, 8, 0, 1167]],
}


def corr_table(data: dict, pairs: list[tuple[str, str]]) -> list[dict]:
    methods = len(next(iter(data.values())))
    designs = len(next(iter(data.values()))[0])
    out = []
    for a, b in pairs:
        per = [spearman([data[a][m][d] for m in range(methods)], [data[b][m][d] for m in range(methods)]) for d in range(designs)]
        winners = sum(1 for d in range(designs) if min(range(methods), key=lambda m: data[a][m][d]) == min(range(methods), key=lambda m: data[b][m][d]))
        out.append({"proxy": a, "real": b, "mean_spearman": round(st.mean(x for x in per if x == x), 2), "per_design": [round(x, 2) for x in per],
                    "same_winner_designs": f"{winners}/{designs}", "methods": methods, "designs": designs})
    return out


def part_b() -> dict:
    return {
        "iccad_early_global_route": corr_table(ICCAD, [("rWL", "TNS"), ("rWL", "WNS"), ("WNS", "TNS")]),
        "openroad_full_flow": corr_table(OPENROAD, [("rWL", "WNS"), ("rWL", "TNS"), ("rWL", "DRC"), ("WNS", "TNS"), ("TNS", "DRC")]),
    }


# --------------------------------------------------------------------------------------------------------------------- doc
def md(a: dict, hs: dict, b: dict) -> str:
    L = ["# proxy 대 실제 격차 (자동 생성: tools/proxy_vs_real_gap.py)", "",
         "싼 지표(proxy)가 나중의 실제 결과와 얼마나 맞는지 본다. A는 우리 데이터, B는 EXPlace 논문 표 값으로 계산한 외부 근거다. OpenLane을 새로 돌리지 않았다.", "",
         "## A. 우리 데이터 — daq_subsystem 실제 OpenLane 결과 대 배치 지표", "",
         "| 실행 | 상태 | 마지막 단계 | 오류 | row channel(µm) | 배치 | 평균 쌍거리(µm) | 라벨로 사용 |", "|---|---|---|---|---|---|---|---|"]
    for r in a["records"]:
        i = r["indicators"]
        L.append(f"| {r['id']} | {r['status']} | {r['last_stage']} | {', '.join(r['error_codes']) or '-'} | {i['row_channel_um']} | {i['topology']} | {i['mean_pairwise_manhattan_um']} | {'예' if r['usable_as_label'] else '아니오(중단)'} |")
    L += ["", "상태가 `incomplete_no_error`인 2건은 오류 없이 중간에 멈춘 재실행이다(원인은 로그에 없다. 같은 흐름이 호스트 절전으로 중단된 사례가 기록돼 있다). 설계의 좋고 나쁨을 보여 주지 않으므로 **라벨에서 제외**했다.", "",
          "### 이 라벨들로 말할 수 있는 것", "",
          "| 실패 유형 | 라벨 | 개수 | 결론 |", "|---|---|---|---|",
          f"| hold repair 합법화(ResizerTimingPostCTS) | {', '.join(f'{l}:{i}' for l, i in a['hold_repair_stage']['labels'])} | {a['hold_repair_stage']['n']} | row channel이 300 → 통과, 100 → 실패, (v2는 채널 없음) → 통과. 지표가 라벨과 일치하지만 **2개 값(100, 300)뿐**이라 경계는 모른다 |",
          f"| 전역 배선 혼잡(GlobalRouting) | {', '.join(f'{l}:{i}' for l, i in a['global_route_stage']['labels'])} | {a['global_route_stage']['n']} | **n=2: 어떤 지표든 둘을 가르는 것은 당연하다. 결론을 낼 수 없다.** 모델의 혼잡 휴리스틱은 둘 다 HIGH였다(노트 기준) |", "",
          "모델이 낮은 가중 배선 길이를 보고한 v2(55,752 대 59,600)가 실제로는 전역 배선에서 실패했다. 낮은 배선 길이 예측이 실제 통과를 보장하지 않은 사례다(노트 기준, 로그 재확인 불가).", "",
          "### 후보 이력(ppa3_adc_capture_top)", "",
          f"- 기록된 후보 {hs['candidates_ever_recorded']}건, 서로 다른 정확한 배치 {hs['distinct_exact_placements']}건, 서로 다른 상대 배치 {hs['distinct_relative_arrangements_exact_mm']}건(1 µm 단위), 추정 배선 길이 값 {hs['distinct_estimate_values']}종.",
          f"- **실제로 검증된 후보: {hs['physically_verified']}건.** 따라서 이 proxy의 격차는 아직 측정할 수 없다. 후보를 더 만들어도 라벨은 늘지 않는다.",
          f"- 중복 제거 후 이력에는 {hs['kept_after_dedup']}건이 남았다(나머지는 optimization_history_duplicates.json에 사유와 함께 보관).", "",
          "## B. 외부 근거 — EXPlace 논문 표(5~6개 방법 × 6~8개 설계)에서 계산", "",
          "같은 설계 안에서 방법들의 순위가 두 지표 사이에서 얼마나 일치하는지(스피어만, 설계별 평균). 방법과 설계 수가 작아 설명용이다.", "",
          "| 평가 | proxy | 실제 | 평균 상관 | 설계별 | 1위 방법 일치 |", "|---|---|---|---|---|---|"]
    for name, rows in (("ICCAD (EarlyGlobalRoute 추정)", b["iccad_early_global_route"]), ("OpenROAD (전체 흐름)", b["openroad_full_flow"])):
        for r in rows:
            L.append(f"| {name} | {r['proxy']} | {r['real']} | {r['mean_spearman']:+.2f} | {r['per_design']} | {r['same_winner_designs']} |")
    L += ["", "## 읽는 법과 우리에게 주는 결론", "",
          "1. 같은 추정 파이프라인 안(ICCAD)에서는 지표가 같이 움직이고, 전체 흐름(OpenROAD)으로 가면 배선 길이는 WNS와 거의 무관하다. **싼 지표는 나쁜 것을 걸러내는 데는 쓸 만하고, 좋은 것들 중에서 고르는 데는 못 쓴다.**",
          "2. 우리 쪽에서 proxy가 가려낸 것은 하나뿐이다: 채널 폭(clean pair 2점). 혼잡은 아직 가릴 지표가 없다.",
          "3. 후보를 많이 만드는 것은 라벨을 늘리지 않는다. 라벨은 실제 흐름(또는 그 일부 단계)을 돌려야만 생기므로, **어떤 후보를 돌릴지**가 핵심이다(docs/macro-placement-improvement-plan.md).", ""]
    return "\n".join(L)


def main() -> int:
    a, hs, b = part_a(), history_stats(), part_b()
    OUT.write_text(json.dumps({"our_data": a, "candidate_history": hs, "paper_derived": b,
                               "source_note": "paper_derived is computed from numeric tables of the EXPlace paper (ICLR 2026); our_data from failure_knowledge.json and optimization_history*.json"},
                              ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DOC.write_text(md(a, hs, b), encoding="utf-8")
    print(f"wrote {DOC.relative_to(ROOT)} and {OUT.relative_to(ROOT)}")
    print("history:", hs)
    for k, rows in b.items():
        for r in rows:
            print(f"  {k}: {r['proxy']} vs {r['real']} mean_spearman={r['mean_spearman']:+.2f} same_winner={r['same_winner_designs']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
