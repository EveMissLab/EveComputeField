import { digest, KERNEL_SHA } from './solver.mjs';
export function verifyHistory(history) {
  if (!Array.isArray(history) || history.length > 64) throw Error('organization history must contain at most 64 records');
  let previous = null;
  for (let i = 0; i < history.length; i++) {
    const { receipt_sha256, ...r } = history[i];
    if (r.schema !== 'ecf-fluid-organization/v1' || r.sequence !== i || r.previous_sha256 !== previous?.receipt_sha256 && !(i === 0 && r.previous_sha256 === null)) throw Error('organization history chain invalid');
    if (digest(r) !== receipt_sha256 || r.kernel_sha256 !== KERNEL_SHA) throw Error('organization history integrity/kernel mismatch');
    if (previous && previous.state_after_sha256 !== r.state_before_sha256) throw Error('organization history state continuity mismatch');
    if (r.success !== true || !Number.isInteger(r.at_step) || r.at_step < 0 || r.to_step < r.at_step || !Number.isFinite(r.at_time_s) || r.at_time_s < 0) throw Error('organization receipt invalid');
    previous = history[i];
  }
  return history;
}
export function appendAdvance(history, before, after, organization) {
  verifyHistory(history);
  const previous = history.at(-1);
  if (previous && previous.state_after_sha256 !== before.integrity_sha256) throw Error('supplied history is not for this checkpoint');
  const r = { schema: 'ecf-fluid-organization/v1', sequence: history.length, previous_sha256: previous?.receipt_sha256 ?? null,
    kind: !previous ? 'initialize-or-import-and-advance' : previous.new_organization === organization.organization && previous.new_partitions === organization.partitions ? 'advance' : 'quiescent-reorganization-and-advance',
    old_organization: previous?.new_organization ?? null, old_partitions: previous?.new_partitions ?? null,
    new_organization: organization.organization, new_partitions: organization.partitions, at_step: before.steps, to_step: after.steps,
    at_time_s: before.time, to_time_s: after.time, success: true, kernel_sha256: KERNEL_SHA,
    config_sha256: digest(after.config), state_before_sha256: before.integrity_sha256, state_after_sha256: after.integrity_sha256 };
  return [...history, { ...r, receipt_sha256: digest(r) }];
}
