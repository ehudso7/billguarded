# Recovery Twin — evidence-to-outcome architecture

## Commercial objective

Turn a detected operational loss into a reviewable recovery action and a
verified outcome without allowing an AI system to invent liability, expose one
customer's records to another, or communicate externally without fresh human
authority.

The first production slice stays inside BillGuarded: a paid audit now produces
both the source-row findings CSV and a deterministic Recovery Review Draft. The
draft is useful immediately, but it is deliberately not sent automatically.

## Why this is an ecosystem, not a new orphan product

| Existing asset | Preserved responsibility |
| --- | --- |
| BillGuarded | Reconcile commercial terms and structured invoices; quantify only supported discrepancies. |
| DockProof | Compile shipment, receiving, photo, scan, email, and retailer evidence into versioned proof packets. |
| Ruligent | Enforce policy, identity, spend/rate limits, kill switches, and fresh human approval before consequential actions. |
| ResultLock | Record the promised outcome, accepted evidence, and final verified result. |

Each product remains independently usable. Recovery Twin is the orchestration
contract between them, not a rebrand or repository merger.

## State machine

1. `detected` — a deterministic rule identifies a potential discrepancy.
2. `evidence_incomplete` — required commercial or operational proof is missing.
3. `evidence_ready` — every assertion cites an available source record.
4. `awaiting_approval` — a proposed external action is frozen for an authorized person.
5. `approved` or `rejected` — the human decision is recorded with policy context.
6. `submitted` — a bounded, approved action is executed exactly once.
7. `counterparty_response` — the response and any new evidence are attached.
8. `outcome_verified` — a credit, refund, correction, or rejection is independently recorded.

No state transition may skip `awaiting_approval` for external communication,
money movement, destructive action, or deployment.

## Evidence contract

Every proposed recovery item must carry:

- tenant and source-document identifiers;
- exact source row, page, or event reference;
- governing contract/rate-card version and effective date when available;
- deterministic calculation inputs and output;
- whether the amount is quantified or review-only;
- missing, conflicting, or low-confidence evidence;
- prior-credit and duplicate-claim checks;
- current lifecycle state and complete transition history.

Language models may classify, extract, summarize, and draft. They may not be the
authority for arithmetic, entitlement, payment truth, or external execution.

## Privacy-preserving network phase

The compounding moat is a cross-customer pattern network that never shares raw
documents, negotiated rates, filenames, company names, or exact amounts.

Only normalized, non-identifying discrepancy signatures may enter cohort
analysis. A cohort signal must remain suppressed until at least five unrelated
organizations contribute eligible outcomes. Small cohorts, unique fee labels,
free-text descriptions, exact timestamps, and other re-identification risks are
blocked. A customer may opt out without losing the standalone product.

The network can eventually answer: "Is this fee pattern repeatedly disputed and
credited across comparable operations?" It cannot answer: "What rate did a
named company negotiate?"

## Production phases

### Phase 0 — shipped in this change

- deterministic Recovery Review Draft;
- source-row citations;
- conservative quantified total;
- explicit review checklist and no-send boundary;
- authenticated, customer-scoped download using the existing paid report gate.

### Phase 1 — buyer-proven integration

- DockProof evidence attachment handoff;
- missing-proof and conflict status;
- versioned recovery packet;
- no external submission.

### Phase 2 — governed action

- Ruligent pre-action guard;
- named human approver and fresh recheck;
- idempotent submission adapter;
- kill switch, rate limit, and complete action receipt.

### Phase 3 — verified outcome

- ResultLock outcome contract;
- counterparty response evidence;
- verified credit/refund/correction ledger;
- conservative realized-ROI reporting.

### Phase 4 — privacy-preserving pattern network

- normalized signatures only;
- minimum cohort size of five;
- opt-out and deletion propagation;
- no cross-tenant raw evidence access;
- cohort insights used for prioritization, never as proof of liability.

## First-profit gate

Do not add a new paid catalog item yet. BillGuarded's existing production offer
is the Full 90-Day Audit at $1,500 one time. The first commercial proof is one
genuine customer completing the existing Checkout and receiving the audit plus
the Recovery Review Draft. A synthetic payment, internal purchase, expired
Checkout Session, or unpaid pilot is not revenue proof.

The warm SMLXL conversation is the shortest buyer-validation path. Send the
existing synthetic demo first, offer the already-promised anonymized one-invoice
fit check, and scope a paid 90-day audit only after the fit check demonstrates a
supported discrepancy or a clear recurring control need.

## Stop conditions

- Do not promise recovery, refunds, credits, or legal entitlement.
- Do not automate dispute submission before Ruligent is integrated and verified.
- Do not expose one tenant's evidence or negotiated terms to another tenant.
- Do not create percentage-of-recovery billing without legal and tax review.
- Do not broaden beyond 3PL invoice reconciliation until a paying customer proves the next workflow.
