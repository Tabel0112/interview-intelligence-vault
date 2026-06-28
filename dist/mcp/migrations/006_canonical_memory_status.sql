DROP TRIGGER IF EXISTS extraction_memory_active_requires_evidence;
CREATE TRIGGER extraction_memory_active_requires_evidence
BEFORE UPDATE OF extraction_status ON memory_objects
WHEN NEW.extraction_status='active'
  AND NOT EXISTS (SELECT 1 FROM memory_object_evidence WHERE memory_id=NEW.id)
  AND NOT EXISTS (
    SELECT 1 FROM evidence_pointers
    WHERE target_type IN ('memory_object','claim','summary') AND target_id=NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'active extracted memory objects require evidence');
END;

DROP TRIGGER IF EXISTS evidence_pointers_cleanup_memory;
CREATE TRIGGER evidence_pointers_cleanup_memory
AFTER DELETE ON evidence_pointers
WHEN OLD.target_type IN ('memory_object','claim','summary')
BEGIN
  UPDATE memory_objects
  SET status='needs_review',
      extraction_status=CASE WHEN extraction_status IS NULL THEN NULL ELSE 'needs_review' END,
      updated_at=CURRENT_TIMESTAMP
  WHERE id=OLD.target_id AND (status='active' OR extraction_status='active')
    AND NOT EXISTS (
      SELECT 1 FROM evidence_pointers
      WHERE target_type IN ('memory_object','claim','summary') AND target_id=OLD.target_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM memory_object_evidence WHERE memory_id=OLD.target_id
    );
END;

CREATE TRIGGER memory_object_evidence_cleanup_memory
AFTER DELETE ON memory_object_evidence
BEGIN
  UPDATE memory_objects
  SET status='needs_review',
      extraction_status=CASE WHEN extraction_status IS NULL THEN NULL ELSE 'needs_review' END,
      updated_at=CURRENT_TIMESTAMP
  WHERE id=OLD.memory_id AND (status='active' OR extraction_status='active')
    AND NOT EXISTS (SELECT 1 FROM memory_object_evidence WHERE memory_id=OLD.memory_id)
    AND NOT EXISTS (
      SELECT 1 FROM evidence_pointers
      WHERE target_type IN ('memory_object','claim','summary') AND target_id=OLD.memory_id
    );
END;

INSERT OR REPLACE INTO app_meta(key, value_json, updated_at)
VALUES ('schema_version', '"006"', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
