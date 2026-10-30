# Published measurement evidence

These files preserve measured numerical values and configurations from R1–R3.
They are a curated publication surface: control-field labels are pseudonymized,
workstation paths and native execution/session bindings are omitted. Runtime
state, credentials, private operational records and screenshots are excluded.

`manifest.json` hashes the delivered files, not the local originals. Numerical
kernel/state hashes remain lineage references. Unreleased runtime audit logs
are not an independently verifiable public identity or durability certificate.

## Byte contract and verification

Hashes and byte lengths bind the raw Git blob bytes. Text in this repository
uses LF according to `.gitattributes`. Verification never converts line endings:
a CRLF checkout that differs from its LF Git blob fails, even if it renders the
same image. Both Linux and Windows CI run:

```
node --test scripts/check-evidence-manifest.test.mjs
node scripts/check-evidence-manifest.mjs --ref HEAD --check-worktree
```

For a deliberate publication update, stage the intended assets and entry list
first. Then derive metadata from the staged blobs and stage the resulting
manifest. The writer changes only manifest metadata, never data or figures:

```
git add research/evidence
node scripts/check-evidence-manifest.mjs --ref INDEX --write
git add research/evidence/manifest.json
node scripts/check-evidence-manifest.mjs --ref INDEX --check-worktree
```

Use a clean LF checkout if working files still have CRLF. The byte verifier
also requires exact tracked-asset coverage and rejects duplicates/missing files.
`--ref COMMIT` checks an immutable historical version; a successful check does
not repair another version retroactively.

The initial R1–R3 publication at `c4ce89c` had six SVG entries calculated before
Git converted CRLF to LF. Their hashes/lengths were corrected from Git blobs;
the committed figures, scientific JSON, numerical kernels and historical
timings were not regenerated. The correction is a packaging-integrity revision.

Historical timings precede publication portability-wrapper/documentation edits.
Numerical kernels retain their measured identities. Fresh test/CI results
validate delivered code separately; they do not remeasure historical latency.

- `r1/`: original river parity/stability and resident-call latency pilot.
- `r2/`: four inventories, water budgets, storage responses and refinement.
- `r3/`: branched graph crossover, interface costs, stability and SVG readback.

Read [RESULTS.md](../RESULTS.md) for limits. Largest grids have fixed step
budgets; separate smaller networks cover60 simulated seconds. Pointwise
bootstrap intervals describe this host, not a universal threshold or
simultaneous multiple-comparison guarantee.
