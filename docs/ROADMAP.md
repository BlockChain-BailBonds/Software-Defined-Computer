# Planned: self-improving software-defined research computer

This file describes future work, not functionality claimed as implemented in the archived releases.

## Proposed deterministic evolution cycle

1. A host-side planner accepts a bounded engineering objective, constraints and repository snapshot.
2. A model drafts a candidate VM program or a source change on a throwaway branch.
3. A static gate rejects unsupported language features, unauthorized API calls, over-budget resources and unknown dependencies.
4. The virtual interpreter executes in a clean, isolated instance with a hard instruction/time/memory budget.
5. A verifier independently compares outputs to explicit tests and invariant assertions; failures cannot promote changes.
6. The system stores input SHA-256, program SHA-256, interpreter version, test outcomes, provenance and score.
7. Accepted candidates are submitted for human review; the baseline remains immutable until a documented merge.
8. A scheduler may repeat approved simulation-only jobs within an owner-defined work quota. No background computation continues when its host process has stopped.

## Acceptance criteria before calling the agent autonomous

- Running scheduler with persistent queue and restart semantics.
- Typed job schemas and independent verification, including adversarial tests for invalid input.
- Explicit opt-in approval and revocation for every hardware action category.
- Reproducible, signed releases with measured performance regressions and deterministic tests.
- Guardrails that prohibit unbounded self-modification, automatic secrets collection and self-propagation.
- External audit of privilege isolation and real-device testing before deployment.

## Implementation ordering

First harden existing VM tests and evidence hashes, then add host-side task scheduler, then verified experiment replay and code diffs, then human-approved merge automation, then optional restricted device-in-the-loop acceptance. Full Linux, Python and GGUF inference remain on compatible hosts unless an independently validated native embedded runtime provides a subset.
