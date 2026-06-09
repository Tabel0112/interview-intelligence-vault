# Processed Transcript JSON Reference

Processed transcripts are generated files at:

`01 Transcripts/Processed/<transcript_id>.processed.json`

They should not be manually created or edited. The pipeline validates and
atomically overwrites the current processed JSON when the source changes or a
forced rewrite is requested.

```json
{
  "schema_version": "processed_transcript.v1",
  "analysis_version": "v1",
  "generated": true,
  "generator": "transcript_pipeline",
  "transcript_id": "example_interview",
  "metadata": {
    "title": "Example Interview",
    "source_file": "Example Interview.md",
    "participants": [],
    "language": null,
    "interview_date": null
  },
  "turns": [],
  "summaries": [],
  "topics": [],
  "evidence_candidates": [],
  "source": {
    "raw_path": "vault/01 Transcripts/Raw/Example Interview.md",
    "raw_filename": "Example Interview.md",
    "source_hash": "<sha256>",
    "modified_at": "<ISO timestamp>"
  },
  "processed_at": "<ISO timestamp>",
  "warnings": []
}
```
