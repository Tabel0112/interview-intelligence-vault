CREATE TABLE obsidian_view_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  output_root TEXT NOT NULL,
  file_count INTEGER NOT NULL CHECK(file_count >= 0),
  graph_node_count INTEGER NOT NULL CHECK(graph_node_count >= 0),
  graph_edge_count INTEGER NOT NULL CHECK(graph_edge_count >= 0),
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed','failed')),
  error_message TEXT
);
CREATE INDEX obsidian_view_runs_created_idx ON obsidian_view_runs(created_at);

CREATE TABLE obsidian_generated_files (
  id TEXT PRIMARY KEY,
  view_run_id TEXT NOT NULL REFERENCES obsidian_view_runs(id) ON DELETE CASCADE,
  logical_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(view_run_id,relative_path)
);
CREATE INDEX obsidian_generated_files_entity_idx ON obsidian_generated_files(entity_type,entity_id);

INSERT OR REPLACE INTO app_meta(key,value_json,updated_at)
VALUES ('schema_version','"012"',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
