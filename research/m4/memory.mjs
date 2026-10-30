// M4 experimental virtual memory domain: stable logical names + checked
// zero-copy SharedArrayBuffer views. Not OS paging, MMU virtualization or a sandbox.
export const MEMORY_SCHEMA = 'ecf-virtual-memory-domain/v0';
const TYPES = Object.freeze({f64: Float64Array, f32: Float32Array, i32: Int32Array, u8: Uint8Array});
const validId = x => typeof x === 'string' && /^[A-Za-z0-9_.-]{1,96}$/.test(x);
function integer(n, min, max, label) {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(`invalid ${label}`);
  return n;
}

export class VirtualMemoryDomain {
  #regions = new Map();
  #buffers = new WeakSet();
  #bytes = 0;
  constructor({fieldId, domainId = 'compute', quotaBytes = 64 * 1024 * 1024, consistency = 'quiescent-barrier'} = {}) {
    if (!validId(fieldId) || !validId(domainId) || consistency !== 'quiescent-barrier') throw Error('invalid memory domain identity/policy');
    this.fieldId = fieldId; this.domainId = domainId;
    this.quotaBytes = integer(quotaBytes, 1, 1024 * 1024 * 1024, 'memory quota');
    this.consistency = consistency;
  }
  #bind(name, buffer, type, access, ownership) {
    if (!validId(name) || this.#regions.has(name) || !Object.hasOwn(TYPES, type) ||
        !['read-only', 'read-write'].includes(access) ||
        !['borrowed', 'owned'].includes(ownership)) throw Error('invalid/duplicate memory region');
    if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength < 1 ||
        buffer.byteLength % TYPES[type].BYTES_PER_ELEMENT || this.#buffers.has(buffer))
      throw Error('invalid, unaligned or aliased shared backing');
    if (this.#bytes + buffer.byteLength > this.quotaBytes) throw Error('memory-domain quota exceeded');
    const region = {name, buffer, type, access, ownership, generation: 1};
    this.#regions.set(name, region); this.#buffers.add(buffer); this.#bytes += buffer.byteLength;
    return this.handle(name);
  }
  allocate({name, type = 'f64', elements, access = 'read-write'} = {}) {
    if (!Object.hasOwn(TYPES, type)) throw Error('unsupported memory type');
    integer(elements, 1, Math.floor(this.quotaBytes / TYPES[type].BYTES_PER_ELEMENT), 'element count');
    const bytes = elements * TYPES[type].BYTES_PER_ELEMENT;
    if (this.#bytes + bytes > this.quotaBytes || this.#regions.has(name) || !validId(name)) throw Error('memory-domain quota or name');
    return this.#bind(name, new SharedArrayBuffer(bytes), type, access, 'owned');
  }
  borrow({name, buffer, type = 'f64', access = 'read-write'} = {}) {
    return this.#bind(name, buffer, type, access, 'borrowed');
  }
  handle(name) {
    const r = this.#regions.get(name); if (!r) throw Error('unknown memory region');
    return Object.freeze({schema: MEMORY_SCHEMA, field_id: this.fieldId, domain_id: this.domainId,
      name, generation: r.generation, type: r.type, length: r.buffer.byteLength / TYPES[r.type].BYTES_PER_ELEMENT,
      access: r.access});
  }
  view(handle, {write = false, offset = 0, elements = undefined} = {}) {
    const r = this.#regions.get(handle?.name);
    if (!r || handle.schema !== MEMORY_SCHEMA || handle.field_id !== this.fieldId ||
        handle.domain_id !== this.domainId || handle.generation !== r.generation || handle.type !== r.type ||
        handle.access !== r.access || handle.length !== r.buffer.byteLength / TYPES[r.type].BYTES_PER_ELEMENT)
      throw Error('stale or foreign memory handle');
    if (write && r.access !== 'read-write') throw Error('read-only memory mapping');
    const length = r.buffer.byteLength / TYPES[r.type].BYTES_PER_ELEMENT;
    integer(offset, 0, length, 'memory offset');
    const count = elements === undefined ? length - offset : integer(elements, 0, length - offset, 'memory length');
    // A raw TypedArray is a *trusted process* view. After exposure it cannot be
    // revoked or made genuinely read-only by JavaScript metadata.
    return new TYPES[r.type](r.buffer, offset * TYPES[r.type].BYTES_PER_ELEMENT, count);
  }
  rebind(name, replacement, {expectedGeneration, quiescent = false} = {}) {
    const r = this.#regions.get(name);
    if (!r || !quiescent || !Number.isSafeInteger(expectedGeneration) || expectedGeneration !== r.generation)
      throw Error('stale/non-quiescent memory remap');
    if (!(replacement instanceof SharedArrayBuffer) ||
        replacement.byteLength !== r.buffer.byteLength || this.#buffers.has(replacement))
      throw Error('memory remap must preserve shape and use fresh shared backing');
    // Domain mappings are metadata leases; earlier raw views remain physically accessible.
    this.#buffers.add(replacement);
    r.buffer = replacement; r.generation++;
    return this.handle(name);
  }
  describe() {
    return {schema: MEMORY_SCHEMA, field_id: this.fieldId, domain_id: this.domainId,
      quota_bytes: this.quotaBytes, mapped_bytes: this.#bytes, consistency: this.consistency,
      regions: [...this.#regions.values()].map(r => ({name:r.name, type:r.type, access:r.access,
        ownership:r.ownership, generation:r.generation, bytes:r.buffer.byteLength}))};
  }
}

// A borrowed, zero-copy M4 view over the unchanged R3 double banks.
// The solver still allocates and owns buffers; M4 does not schedule their use.
export function observeR3Banks(solver, {fieldId = 'local-field', quotaBytes = 128 * 1024 * 1024} = {}) {
  if (!solver?.buffers || ![0, 1].includes(solver.bank)) throw Error('R3 solver adapter required');
  const domain = new VirtualMemoryDomain({fieldId, domainId: 'r3-water', quotaBytes});
  const type = solver.options.precision === 'f32-state' ? 'f32' : 'f64';
  const handles = {};
  for (const name of ['h0', 'q0', 'h1', 'q1'])
    handles[name] = domain.borrow({name, buffer: solver.buffers[name], type});
  return {domain, handles, active: () => ({
    bank: solver.bank, h: domain.handle(solver.bank ? 'h1' : 'h0'),
    q: domain.handle(solver.bank ? 'q1' : 'q0'),
  }), backing_owner: 'R3; M4 descriptor borrows without copying'};
}
