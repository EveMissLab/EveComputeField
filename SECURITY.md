# Security — reference status

This code is a research/reference prototype. It does not have a production security audit.

## Default posture

- Do not expose `worker` to the public internet. By default it binds `127.0.0.1`.
- Every worker process requires TLS 1.3, a server certificate and a trusted CA, and **verified client certificates**. Plain HTTP is never exposed by the CLI worker.
- Development certificates (`certs`) are issued for seven days and include a **CA private key**. Use only for tests; do not commit them, and distribute the CA certificate and role-specific credentials separately.
- Transport authentication is **not fine-grained authorization**. The v0.1 worker accepts any identity signed by its configured trusted CA; no per-user/tenant permission table exists.
- Only `sum` and `mul` pure numeric requests are accepted. There is no arbitrary shell, no file execution, no upload, and no URL fetch.
- Input size and worker request timeout are bounded. Memory domain quotas are reference limits, not proof of process-level resource isolation.
- State snapshots are plaintext. Do not store secrets, personal records, production dataset, or private source here.

## Known limitations

- No secure client enrollment / device revocation / user RBAC / audit trail of device identities.
- No container or OS-level worker sandbox beyond the deliberately restricted operations.
- No per-task CPU budget on the local executor (can compute fast but large arrays remain bounded by request parser).
- A compromised, explicitly trusted worker could return forged answers. End-to-end result validation or redundant execution is a future gate.
- Snapshot save uses a temporary file and filesystem rename; it does not guarantee transactional durability across power failure or malicious filesystems.
- Peer discovery and NAT traversal do not exist; local-network operations must be manually configured.

## Release security gates

Before accepting arbitrary programs or public remote workers: independent process sandbox, capabilities and policy enforcement, worker revocation, version negotiation, signed module provenance, resource quotas, replay/rollback semantics, and external security review.

## Reporting

Use the repository's security reporting mechanism after public release; do not place real exploit details or credentials in a public issue.
