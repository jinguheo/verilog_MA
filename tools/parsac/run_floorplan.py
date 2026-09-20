"""Run parallel PARSAC searches and emit dashboard-friendly JSON."""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import sys


COST_FIELDS = [
    'white_space', 'wirelength', 'area', 'edge_violations',
    'cluster_fragments', 'rectilinear_fragments', 'total',
    'width_penalty', 'height_penalty', 'preplaced_cost',
]


def _prepare(model: dict):
    blocks = model['blocks']
    block_index = {block['name']: index for index, block in enumerate(blocks)}
    pin_index = {
        pin['name']: len(blocks) + index for index, pin in enumerate(model['pins'])
    }
    specs = [
        [
            block['width'], block['height'], block.get('edge', 0),
            block.get('group', 0), 0, int(block.get('fixed_aspect', True)),
            int(block.get('preplaced', False)), block.get('x', 0), block.get('y', 0),
        ]
        for block in blocks
    ]
    terminals = [[pin['x'], pin['y']] for pin in model['pins']]
    nets = [
        [block_index[name] if name in block_index else pin_index[name] for name in net]
        for net in model['nets']
    ]
    return specs, terminals, nets


def _run_once(repo_text: str, model: dict, steps: int, seed: int) -> dict:
    repo = Path(repo_text)
    sys.path.insert(0, str(repo))
    from src.c_src import ca_sa
    from src.sa_config import SAConfig

    specs, terminals, nets = _prepare(model)
    outline = model['outline']
    ca_sa.set_seed(seed)
    config = SAConfig(ca_sa)
    config.set_config({
        'alpha': 0.5, 'T0': 0.001, 'beta': 10.0, 'beta_cluster': 10.0,
        'fixing_prob': 0.001, 'ws_ratio': 0.0, 'chip_ar': 1.0,
        'inverse': 0, 'ar_search': False, 'ws_threshold': 10,
    })
    ca_sa.set_floorplan_boundaries(
        outline['width'], outline['height'], 100.0, True
    )
    ca_sa.read_nets(nets)
    ca_sa.read_terminals(terminals)
    ca_sa.read_blocks(specs, False)
    ca_sa.hard_preplace_constraints(True)
    ca_sa.initialize(1)
    ca_sa.clear_trajectory()
    ca_sa.set_step_limit(steps)
    ca_sa.sa_refine()

    positions = ca_sa.get_bpos()
    costs = ca_sa.compute_cost()
    placed = []
    for block, position in zip(model['blocks'], positions):
        placed.append({
            **block,
            'x': position[0], 'y': position[1],
            'width': position[2], 'height': position[3],
        })
    boundary_violations = [
        block['name'] for block in placed
        if block['x'] < 0 or block['y'] < 0
        or block['x'] + block['width'] > outline['width']
        or block['y'] + block['height'] > outline['height']
    ]
    overlaps = []
    for index, first in enumerate(placed):
        for second in placed[index + 1:]:
            separated = (
                first['x'] + first['width'] <= second['x']
                or second['x'] + second['width'] <= first['x']
                or first['y'] + first['height'] <= second['y']
                or second['y'] + second['height'] <= first['y']
            )
            if not separated:
                overlaps.append([first['name'], second['name']])
    return {
        'seed': seed,
        'cost': dict(zip(COST_FIELDS, costs)),
        'blocks': placed,
        'placement_validation': {
            'passed': not boundary_violations and not overlaps,
            'boundary_violations': boundary_violations,
            'overlaps': overlaps,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--steps', type=int, default=2000)
    parser.add_argument('--runs', type=int, default=8)
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    model = json.loads(args.input.read_text(encoding='utf-8'))
    repo = Path(__file__).resolve().parents[2] / '.local-cache' / 'tools' / 'parsac'
    seeds = [model.get('seed', 4300) + index for index in range(args.runs)]
    with ProcessPoolExecutor(max_workers=min(args.workers, args.runs)) as pool:
        futures = [
            pool.submit(_run_once, str(repo), model, args.steps, seed)
            for seed in seeds
        ]
        runs = [future.result() for future in futures]
    def legality_key(run: dict):
        cost = run['cost']
        violations = (
            cost['edge_violations'] + cost['width_penalty'] + cost['height_penalty']
        )
        coordinate_invalid = not run['placement_validation']['passed']
        return (coordinate_invalid, violations > 0, violations, cost['total'])

    best = min(runs, key=legality_key)
    result = {
        'status': 'passed',
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'tool': 'IntelLabs PARSAC',
        'mode': 'Windows-native parallel coarse floorplanning',
        'source_model': model['name'],
        'source': model.get('source'),
        'connectivity_source': model.get('connectivity_source'),
        'coordinate_scale': model.get('coordinate_scale'),
        'steps_per_run': args.steps,
        'runs': args.runs,
        'workers': min(args.workers, args.runs),
        'outline': model['outline'],
        'pins': model['pins'],
        'best': best,
        'placement_validation': best['placement_validation'],
        'run_costs': [
            {'seed': run['seed'], **run['cost']} for run in runs
        ],
        'caveat': (
            'PoC geometry is an engineering model. Confirm the selected placement '
            'with OpenLane/OpenROAD placement and signoff.'
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )
    print(f"PARSAC_RESULT={args.output}")
    print(f"BEST_SEED={best['seed']} TOTAL_COST={best['cost']['total']:.6f}")


if __name__ == '__main__':
    main()
