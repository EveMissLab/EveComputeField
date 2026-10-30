// M4 experimental local placement. A logical unit is a scheduling identity,
// not a hardware core, worker thread, memory page or claimed speedup.
import { createHash } from 'node:crypto';

export const PLACEMENT_SCHEMA = 'ecf-local-placement/v1';
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const integer = (x, min, max, name) => {
  if (!Number.isSafeInteger(x) || x < min || x > max) throw Error(`invalid ${name}`);
  return x;
};
function checkLayout(layout) {
  if (!layout || !Array.isArray(layout.tiles) || !Array.isArray(layout.reaches) ||
      !layout.tiles.length || layout.tiles.length > 4096 ||
      !Number.isSafeInteger(layout.cells) || layout.cells < 1) throw Error('invalid tile layout');
  const lastEnd = new Map();
  for (const tile of layout.tiles) {
    const edge = integer(tile.edge, 0, layout.reaches.length - 1, 'tile edge');
    const reach = layout.reaches[edge];
    integer(tile.start, 0, reach.cells - 1, 'tile start');
    integer(tile.end, tile.start + 1, reach.cells, 'tile end');
    const before = lastEnd.get(edge) ?? 0;
    if (tile.start !== before) throw Error('tiles must cover reaches in stable contiguous order');
    lastEnd.set(edge, tile.end);
  }
  if (layout.reaches.some((r, i) => lastEnd.get(i) !== r.cells)) throw Error('incomplete tile coverage');
  if (layout.reaches.reduce((n, r) => n + r.cells, 0) !== layout.cells) throw Error('cell/layout mismatch');
}

export function createPlacement({ fieldId = 'local-field', logicalUnits, layout, workers = 0,
                                   mode = 'fused', exchange = 'direct', generation = 0 }) {
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(fieldId)) throw Error('invalid field ID');
  integer(logicalUnits, 1, 65536, 'logical unit count');
  integer(generation, 0, 1000000000, 'placement generation');
  checkLayout(layout);
  integer(workers, 0, Math.min(8, layout.tiles.length), 'physical worker count');
  if (!['fused', 'cells-only'].includes(mode) || !['direct', 'message-copy'].includes(exchange))
    throw Error('invalid execution strategy');
  const total = layout.tiles.length;
  // Exact partition of the immutable R3 TilePool. The logical-unit association
  // is metadata in M4; the physical pool still consumes contiguous tile ranges.
  const ranges = workers ? Array.from({length: workers}, (_, p) => ({
    worker: p, start_tile: Math.floor(p * total / workers), end_tile: Math.floor((p + 1) * total / workers),
  })) : [{worker: null, start_tile: 0, end_tile: total}];
  const tiles = layout.tiles.map((tile, t) => ({
    tile: t, edge: tile.edge, cell_start: tile.start, cell_end: tile.end,
    logical_unit: Math.floor(t * logicalUnits / total),
    worker: workers ? ranges.find(r => t >= r.start_tile && t < r.end_tile).worker : null,
  }));
  const identity = {schema: PLACEMENT_SCHEMA, field_id: fieldId, generation, logical_units: logicalUnits,
    total_cells: layout.cells, tile_count: total, workers, mode, exchange,
    layout: layout.tiles.map(t => [t.edge, t.start, t.end])};
  let workerSeams = 0;
  for (let i = 1; i < tiles.length; i++)
    if (tiles[i].edge === tiles[i-1].edge && tiles[i].worker !== tiles[i-1].worker) workerSeams++;
  return { ...identity, mapping_sha256: digest(identity), active_logical_units: new Set(tiles.map(t => t.logical_unit)).size,
    worker_seams: workerSeams, ranges, tiles,
    semantics: 'R3-compatible contiguous tiles; virtual unit IDs are associations, not OS threads'};
}
const median = values => {
  const v = [...values].sort((a, b) => a - b), n = v.length;
  if (!n) throw Error('empty measurements');
  return n % 2 ? v[Math.floor(n / 2)] : (v[n / 2 - 1] + v[n / 2]) / 2;
};
const validMs = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
export function selectPlacement({fieldId = 'local-field', logicalUnits, layout, evidence,
                                  graphSha256, kernelSha256, expectedHost, expectedCalls = 20,
                                  minBenefit = 1.10, minPairs = 6}) {
  integer(expectedCalls, 1, 1000000, 'expected calls');
  integer(minPairs, 4, 10000, 'minimum pairs');
  if (typeof minBenefit !== 'number' || minBenefit < 1 || minBenefit > 10) throw Error('invalid benefit threshold');
  checkLayout(layout);
  if (!evidence || evidence.schema !== 'ecf-m4-matched-probes/v1' || evidence.cells !== layout.cells ||
      evidence.tile_count !== layout.tiles.length || typeof evidence.graph_sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(evidence.graph_sha256) ||
      typeof evidence.kernel_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(evidence.kernel_sha256) ||
      !Array.isArray(evidence.arms) || evidence.graph_sha256 !== graphSha256 ||
      evidence.kernel_sha256 !== kernelSha256 ||
      !expectedHost || JSON.stringify(evidence.host) !== JSON.stringify(expectedHost))
    throw Error('incompatible/unbound measurement evidence');
  const candidates = [], discarded = [];
  for (const arm of evidence.arms) {
    const workerCount = arm.workers;
    if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8 ||
        !['fused', 'cells-only'].includes(arm.mode) || !['direct', 'message-copy'].includes(arm.exchange) ||
        !validMs(arm.setup_ms) || !Array.isArray(arm.pairs)) {
      discarded.push({workers: workerCount, reason: 'invalid arm'}); continue;
    }
    if (workerCount > layout.tiles.length || arm.pairs.length < minPairs) {
      discarded.push({workers: workerCount, reason: 'insufficient samples/tiles'}); continue;
    }
    const blocks = new Map(), serial = [], parallel = [], ratios = [];
    let valid = true;
    for (const p of arm.pairs) {
      if (!validMs(p.serial_ms) || !validMs(p.parallel_ms) || p.identical_state !== true ||
          !Number.isInteger(p.block) || p.block < 0 || p.block > 1) { valid = false; break; }
      const ratio = p.serial_ms / p.parallel_ms;
      serial.push(p.serial_ms); parallel.push(p.parallel_ms); ratios.push(ratio);
      if (!blocks.has(p.block)) blocks.set(p.block, []);
      blocks.get(p.block).push(ratio);
    }
    if (!valid || blocks.size !== 2 || [...blocks.values()].some(x => x.length < 2)) {
      discarded.push({workers: workerCount, reason: 'state mismatch or missing independent blocks'}); continue;
    }
    const speedup = Math.exp(median(ratios.map(Math.log)));
    const serialMedian = median(serial), parallelMedian = median(parallel);
    const blockRatios = [...blocks.values()].map(xs => Math.exp(median(xs.map(Math.log))));
    // This is an operational rule, NOT a confidence interval or hardware-general conclusion.
    const netSavedMs = (serialMedian - parallelMedian) * expectedCalls - arm.setup_ms;
    const passed = speedup >= minBenefit && blockRatios.every(x => x > 1) && netSavedMs > 0;
    const report = {workers: workerCount, mode: arm.mode, exchange: arm.exchange, pairs: ratios.length,
      median_speedup: speedup, block_speedups: blockRatios, serial_median_ms: serialMedian,
      candidate_median_ms: parallelMedian, setup_ms: arm.setup_ms, expected_net_saved_ms: netSavedMs,
      passes_operational_gate: passed};
    (passed ? candidates : discarded).push(passed ? report : {...report, reason: 'gate not met'});
  }
  candidates.sort((a, b) => b.expected_net_saved_ms - a.expected_net_saved_ms || a.workers - b.workers);
  const chosen = candidates[0] || null;
  const placement = createPlacement({fieldId, logicalUnits, layout, workers: chosen?.workers ?? 0,
    mode: chosen?.mode ?? 'fused', exchange: chosen?.exchange ?? 'direct'});
  return {schema: 'ecf-m4-selection/v1', measurement_binding: {graph_sha256: evidence.graph_sha256,
    kernel_sha256: evidence.kernel_sha256, cells: evidence.cells, tile_count: evidence.tile_count,
    host: evidence.host || null, expected_calls: expectedCalls}, placement, selected: chosen,
    confirmed_alternatives: candidates, rejected: discarded,
    note: 'Local matched measurement only. Not a physical-core or AI acceleration claim.'};
}

// Call only when the field is quiescent. The R3 resident manager already
// serializes explicit reorganizations, but this adapter itself is not a lock.
export async function applyPlacement(solver, placement) {
  if (!solver || typeof solver.reorganize !== 'function' || typeof solver.stateHash !== 'function')
    throw Error('solver adapter required');
  if (placement.schema !== PLACEMENT_SCHEMA || placement.tile_count !== solver.layout.tiles.length ||
      placement.total_cells !== solver.layout.cells) throw Error('incompatible placement');
  const expected = createPlacement({fieldId: placement.field_id, logicalUnits: placement.logical_units,
    layout: solver.layout, workers: placement.workers, mode: placement.mode,
    exchange: placement.exchange, generation: placement.generation});
  if (placement.mapping_sha256 !== expected.mapping_sha256) throw Error('tampered placement');
  const before = solver.stateHash(), buffers = Object.values(solver.buffers);
  const old = {workers: solver.options.workers, mode: solver.options.mode, exchange: solver.options.exchange};
  if (old.workers !== placement.workers || old.mode !== placement.mode || old.exchange !== placement.exchange)
    await solver.reorganize(placement.workers, placement.mode, placement.exchange);
  if (solver.stateHash() !== before || Object.values(solver.buffers).some((b, i) => b !== buffers[i]))
    throw Error('physical state/backing changed across organization switch; audit required');
  return {schema: 'ecf-m4-reorganization-receipt/v1', from: old,
    to: {workers: placement.workers, mode: placement.mode, exchange: placement.exchange},
    physical_state_unchanged: true, backing_buffers_unchanged: true, state_sha256: before,
    mapping_sha256: placement.mapping_sha256};
}
