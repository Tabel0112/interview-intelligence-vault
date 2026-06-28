-- Persist the live Ask AI claim support state so reconstruction is trust-faithful.
--
-- Before this, getAskAIResponse read answer_claims.support_status, which provenance pointer logic can
-- PROMOTE (e.g. a mixed-strength claim pointer -> 'supported') independently of the answer-level
-- confidence. A claim the live pipeline labeled 'weakly_supported' could reload as 'supported', dropping
-- its caution. We now store the live per-claim support state on the Ask-AI-owned metadata row and read
-- it back. Nullable: legacy rows reconstruct via a conservative fallback capped by the answer-level
-- evidence_confidence (never upgrading). This does NOT touch answer_claims, citation_links, provenance
-- triggers, or corrections — those keep their own (promotable) provenance semantics.

ALTER TABLE ask_ai_claim_metadata ADD COLUMN support_status TEXT
  CHECK(support_status IS NULL OR support_status IN ('supported','weakly_supported','conflicting','unsupported'));
