#!/usr/bin/env bash
# Measures the actual wall-clock difference between running
# 107_synth_explore.sh sequentially (one design after another) vs
# concurrently (all three backgrounded, waited on together) for
# chan_ctrl/cnt_sat/skid_buffer - not a guess, timed both ways in the same
# session so the comparison is apples-to-apples.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/108_synth_explore_compare.sh
#
# Each design writes its own log under runs_compare_logs/<mode>_<design>.log
# so nothing between the two runs is race-prone: 107_synth_explore.sh's own
# shim is already per-design (see its header), and each design's own
# asic/<design>/runs/RUN_* directory is independent regardless of mode.
#
# What this does NOT measure: whether the two modes give different
# synthesis RESULTS. They should not, and should not be expected to -
# SYNTH_STRATEGY exploration for one design has nothing to do with any
# other design's run, so the only variable here is wall-clock time. The
# per-design comparison tables are checked to be identical (modulo run
# timestamp) as a sanity check, not because a difference was expected.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
SAMPLE="$REPO/samples/sample_test_4"
SCRIPT="$REPO/tools/wsl/107_synth_explore.sh"
LOGDIR="$SAMPLE/asic/runs_compare_logs"
mkdir -p "$LOGDIR"

DESIGNS=(chan_ctrl cnt_sat skid_buffer)

echo "=== Pre-warming shims (one-time cost, excluded from both timings) ==="
for d in "${DESIGNS[@]}"; do
  bash "$SCRIPT" "$d" > "$LOGDIR/prewarm_$d.log" 2>&1 || true
done

echo
echo "=== SEQUENTIAL: one design after another ==="
SEQ_START=$(date +%s.%N)
for d in "${DESIGNS[@]}"; do
  d_start=$(date +%s.%N)
  bash "$SCRIPT" "$d" > "$LOGDIR/sequential_$d.log" 2>&1
  d_end=$(date +%s.%N)
  printf '  %-12s %.1fs\n' "$d" "$(echo "$d_end - $d_start" | bc)"
done
SEQ_END=$(date +%s.%N)
SEQ_TOTAL=$(echo "$SEQ_END - $SEQ_START" | bc)
printf 'sequential total: %.1fs\n' "$SEQ_TOTAL"

echo
echo "=== CONCURRENT: all three backgrounded together ==="
PAR_START=$(date +%s.%N)
pids=()
for d in "${DESIGNS[@]}"; do
  bash "$SCRIPT" "$d" > "$LOGDIR/concurrent_$d.log" 2>&1 &
  pids+=($!)
done
for pid in "${pids[@]}"; do
  wait "$pid"
done
PAR_END=$(date +%s.%N)
PAR_TOTAL=$(echo "$PAR_END - $PAR_START" | bc)
printf 'concurrent total: %.1fs\n' "$PAR_TOTAL"

echo
echo "=== Sanity check: did concurrent runs produce the same per-strategy numbers? ==="
for d in "${DESIGNS[@]}"; do
  seq_table="$(grep -A 12 'SYNTH_STRATEGY.*Gates' "$LOGDIR/sequential_$d.log" | tail -n +3 | grep -E '^\s*│' | sed -E 's/[0-9]{2}:[0-9]{2}:[0-9]{2}//')"
  con_table="$(grep -A 12 'SYNTH_STRATEGY.*Gates' "$LOGDIR/concurrent_$d.log" | tail -n +3 | grep -E '^\s*│' | sed -E 's/[0-9]{2}:[0-9]{2}:[0-9]{2}//')"
  if [ "$seq_table" == "$con_table" ]; then
    echo "  $d: IDENTICAL"
  else
    echo "  $d: DIFFERS (see $LOGDIR/sequential_$d.log vs concurrent_$d.log)"
  fi
done

echo
SPEEDUP=$(echo "scale=2; $SEQ_TOTAL / $PAR_TOTAL" | bc)
echo "=== RESULT ==="
printf 'sequential : %.1fs\n' "$SEQ_TOTAL"
printf 'concurrent : %.1fs\n' "$PAR_TOTAL"
printf 'speedup    : %sx\n' "$SPEEDUP"

cat > "$LOGDIR/comparison_summary.txt" <<EOF
Sequential vs concurrent SynthesisExploration (chan_ctrl, cnt_sat, skid_buffer)
Generated: $(date -Iseconds)

sequential total: ${SEQ_TOTAL}s
concurrent total: ${PAR_TOTAL}s
speedup: ${SPEEDUP}x
EOF
echo "written: $LOGDIR/comparison_summary.txt"
