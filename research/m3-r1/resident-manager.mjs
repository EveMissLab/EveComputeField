import { ResearchSolver, digest, KERNEL_SHA } from './solver.mjs';
import { performance } from 'node:perf_hooks';
export function validateReceipt(receipt) {
  if (!receipt) return null;
  const { receipt_sha256, ...content } = receipt;
  if (content.schema !== 'ecf-fluid-resident-receipt/v1' || content.kernel_sha256 !== KERNEL_SHA || digest(content) !== receipt_sha256) throw Error('resident receipt integrity/kernel mismatch');
  return receipt;
}
export class ResidentManager {
  constructor(eventSink = async () => {}) { this.entries = new Map(); this.eventSink = eventSink; }
  create(id, config = {}, options = {}, checkpoint = null, receipt = null) {
    if (!/^[A-Za-z0-9_.-]{1,96}$/.test(id) || ['.','..'].includes(id)) throw Error('invalid resident id');
    if (this.entries.has(id)) throw Error('resident id already active');
    if (this.entries.size >= 4) throw Error('resident session limit reached');
    validateReceipt(receipt);
    if (receipt && receipt.field_id !== id) throw Error('receipt belongs to another field');
    if (receipt && receipt.state_after_sha256 !== checkpoint?.integrity_sha256) throw Error('receipt does not bind restored state');
    const start = performance.now();
    const solver = checkpoint ? ResearchSolver.restore(checkpoint, options) : new ResearchSolver(config, options);
    const entry = { id, solver, head: receipt, queue: Promise.resolve(), calls: 0, poolCreations: solver.pool ? 1 : 0,
      initialH: solver.h.buffer, initialQ: solver.q.buffer, initialPool: solver.pool, setup_ms: performance.now() - start, blocked: false };
    this.entries.set(id, entry); return this.view(id);
  }
  entry(id) { const e = this.entries.get(id); if (!e) throw Error('resident id not found'); return e; }
  async createAndBind(id, config, options, checkpoint, receipt, bind) {
    this.create(id, config, options, checkpoint, receipt);
    const e = this.entry(id); e.pendingAssociation = true; e.blocked = true;
    const result = e.queue.then(async () => {
      try { await bind(e); e.pendingAssociation = false; e.blocked = false; return this.view(id); }
      catch (error) { e.pendingAssociation = false; e.blocked = true; throw Error(`association save failed; RAM retained but blocked: ${error.message}`); }
    });
    e.queue = result.catch(() => {}); return result;
  }
  async queued(id, action) { const e = this.entry(id), result = e.queue.then(() => { if (e.blocked) throw Error('resident session needs audit recovery'); return action(e); }); e.queue = result.catch(() => {}); return result; }
  view(id) { const e = this.entry(id); return { id, metrics: e.solver.measure(), organization: e.solver.receipt(), advance_calls: e.calls,
    worker_pool_creations: e.poolCreations, setup_ms: e.setup_ms, buffers_reused: e.solver.h.buffer === e.initialH && e.solver.q.buffer === e.initialQ,
    original_pool_reused: e.solver.pool === e.initialPool, rss_bytes: process.memoryUsage().rss,
    state_sha256: e.solver.checkpoint().integrity_sha256, receipt_head: e.head?.receipt_sha256 ?? null, blocked: e.blocked, pending_association: e.pendingAssociation === true }; }
  async record(e, before, kind) {
    if (e.head && e.head.state_after_sha256 !== before.integrity_sha256) { e.blocked = true; throw Error('live state diverged from resident audit head'); }
    const after = e.solver.checkpoint(), org = e.solver.receipt();
    const content = { schema: 'ecf-fluid-resident-receipt/v1', kernel_sha256: KERNEL_SHA, field_id: e.id,
      sequence: (e.head?.sequence ?? -1) + 1, previous_sha256: e.head?.receipt_sha256 ?? null, kind,
      state_before_sha256: before.integrity_sha256, state_after_sha256: after.integrity_sha256,
      at_step: before.steps, to_step: after.steps, at_time_s: before.time, to_time_s: after.time,
      config_sha256: digest(after.config), organization: org.organization, partitions: org.partitions, success: true };
    const receipt = { ...content, receipt_sha256: digest(content) };
    try { await this.eventSink(e.id, receipt); } catch (error) { e.blocked = true; throw Error(`audit append failed; live state retained and session blocked: ${error.message}`); }
    e.head = receipt; return after;
  }
  async advance(id, steps) { return this.queued(id, async e => {
    if (!Number.isInteger(steps) || steps < 0 || steps > 10000) throw Error('steps must be integer in 0..10000');
    const before = e.solver.checkpoint(), begin = performance.now();
    try { e.solver.advanceSteps(steps); } catch (error) { e.blocked = true; throw Error(`numerical advance failed; partial RAM state retained for diagnosis: ${error.message}`); }
    const done = performance.now(); e.calls++; await this.record(e, before, 'resident-advance'); return { ...this.view(id), compute_ms: done - begin, total_with_audit_ms: performance.now() - begin };
  }); }
  async reorganize(id, partitions, organization) { return this.queued(id, async e => { const before = e.solver.checkpoint(), old = e.solver.pool; await e.solver.reorganize(partitions, organization); if (e.solver.pool && e.solver.pool !== old) e.poolCreations++; await this.record(e, before, 'quiescent-reorganization'); return this.view(id); }); }
  async snapshot(id) { return this.queued(id, e => ({ schema: 'ecf-fluid-resident-checkpoint/v1', checkpoint: e.solver.checkpoint(), options: { partitions: e.solver.options.partitions, organization: e.solver.options.organization }, receipt: e.head })); }
  async persist(id, persistFn) { return this.queued(id, async e => {
    const snapshot = { schema: 'ecf-fluid-resident-checkpoint/v1', checkpoint: e.solver.checkpoint(), options: { partitions: e.solver.options.partitions, organization: e.solver.options.organization }, receipt: e.head };
    // Keep the durable write inside the same serialized transition as its snapshot.
    return await persistFn(snapshot);
  }); }
  async close() { for (const e of this.entries.values()) { await e.queue; await e.solver.close(); } }
}
