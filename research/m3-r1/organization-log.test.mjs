import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchSolver } from './solver.mjs';
import { appendAdvance, verifyHistory } from './organization-log.mjs';
test('organization receipts preserve a state-linked reconfiguration chain', async () => {
  const s = new ResearchSolver();
  try {
    const a = s.checkpoint(); s.advanceSteps(10); const b = s.checkpoint();
    let history = appendAdvance([], a, b, s.receipt());
    await s.reorganize(4, 'partitioned-serial'); s.advanceSteps(10);
    history = appendAdvance(history, b, s.checkpoint(), s.receipt());
    assert.equal(history[1].kind, 'quiescent-reorganization-and-advance'); assert.equal(history[1].old_partitions, 1); assert.equal(history[1].new_partitions, 4);
    assert.equal(verifyHistory(JSON.parse(JSON.stringify(history))).length, 2);
    const bad = structuredClone(history); bad[1].new_partitions = 8; assert.throws(() => verifyHistory(bad));
    assert.throws(() => appendAdvance(history, a, b, s.receipt()), /not for this checkpoint/);
  } finally { await s.close(); }
});
