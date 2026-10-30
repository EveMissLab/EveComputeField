# Security — reference status

This code is a research/reference prototype. It does not have a production security audit.

## M1 local authority control boundary

- `evefield serve` listens only on explicit `127.0.0.1` or `::1`; wildcard and
  non-local addresses are rejected. **Never reverse-proxy this control service**
  to an untrusted network or make it publicly accessible.
- `evefield token` generates a random 256-bit bearer secret in a file created
  owner-only on POSIX. Windows deployments need an appropriate filesystem ACL
  review: POSIX `0600` does not itself define Windows DACL semantics.
- Every control action needs that token. Browser `Origin` requests are denied;
  no CORS permission is granted. Control traffic is plaintext loopback HTTP,
  not an encrypted remote control protocol.
- The field directory and token must be accessible only to the authorized
  operator; an attacker with local account/file access may bypass the service.
- `serve` takes a single-writer `.authority.lock`; after an unclean exit verify
  that no competing process remains before manually clearing it.
- Snapshots and other saved field state are plaintext; do not store secrets.
- This is not a production multi-tenant authorization boundary. There is no
  tenant RBAC, signed policy, credential revocation or remote-control audit.

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
