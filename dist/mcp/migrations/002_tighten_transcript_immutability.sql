DROP TRIGGER IF EXISTS transcripts_raw_fields_immutable;

CREATE TRIGGER transcripts_raw_fields_immutable
BEFORE UPDATE OF source_id, title, language, content_hash, imported_at ON transcripts BEGIN
  SELECT RAISE(ABORT, 'raw transcript identity is immutable');
END;

INSERT OR REPLACE INTO app_meta(key, value_json, updated_at)
VALUES ('schema_version', '"002"', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
