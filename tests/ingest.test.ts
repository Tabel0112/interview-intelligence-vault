import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, ValidationError, type SqliteDatabase } from "../src/db/index.js";
import {
  computeRawSha256, createSpansFromTurns, detectTranscriptFormat, importTranscript,
  parseSpeakerTurns, parseTimestampRange, parseTimestampToMs,
} from "../src/ingest/index.js";

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

describe("format, hash, and timestamp utilities", () => {
  it("hashes raw content deterministically", () => {
    expect(computeRawSha256("same")).toBe(computeRawSha256("same"));
    expect(computeRawSha256("same")).not.toBe(computeRawSha256("different"));
  });

  it.each([
    ["a.txt", "txt"], ["a.md", "md"], ["a.srt", "srt"], ["a.vtt", "vtt"],
  ] as const)("detects %s", (filename, format) => {
    expect(detectTranscriptFormat(filename, "text")).toBe(format);
  });

  it("rejects unsupported formats", () => {
    expect(() => detectTranscriptFormat("a.pdf", "text")).toThrow(ValidationError);
  });

  it.each([
    ["00:01:23", 83_000], ["00:01:23.500", 83_500], ["00:01:23,500", 83_500], ["01:23", 83_000],
  ] as const)("parses timestamp %s", (value, expected) => {
    expect(parseTimestampToMs(value)).toBe(expected);
  });

  it("parses SRT and VTT timestamp ranges", () => {
    expect(parseTimestampRange("00:00:01,000 --> 00:00:04,000")).toEqual({ startTimeMs: 1000, endTimeMs: 4000 });
    expect(parseTimestampRange("00:00:01.000 --> 00:00:04.000")).toEqual({ startTimeMs: 1000, endTimeMs: 4000 });
  });
});

describe("deterministic turn and span parsing", () => {
  it("detects speakers, timestamps, normalization, and continuation lines", () => {
    const raw = "[00:01:23] Baiyang Chen: First line\r\ncontinuation\r\n\r\nAlex: hello";
    const turns = parseSpeakerTurns(raw, "txt");
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ speakerLabel: "Baiyang Chen", speakerNormalized: "baiyang chen", startTimeMs: 83_000, startLine: 1, endLine: 2 });
    expect(turns[0].rawText).toBe("[00:01:23] Baiyang Chen: First line\r\ncontinuation");
    expect(turns[1]).toMatchObject({ speakerLabel: "Alex", startTimeMs: null });
  });

  it("creates caption turns with range timestamps", () => {
    const srt = "1\n00:00:01,000 --> 00:00:04,000\nAlex: Hello there.\n\n2\n00:00:05,000 --> 00:00:06,000\nGoodbye.";
    const turns = parseSpeakerTurns(srt, "srt");
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ speakerLabel: "Alex", startTimeMs: 1000, endTimeMs: 4000, rawText: "Alex: Hello there." });
    expect(turns[1].speakerLabel).toBeNull();
  });

  it("creates VTT caption turns", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nAlex: Hello from VTT.";
    expect(parseSpeakerTurns(vtt, "vtt")[0]).toMatchObject({
      speakerLabel: "Alex", startTimeMs: 1000, endTimeMs: 4000, rawText: "Alex: Hello from VTT.",
    });
  });

  it("creates paragraph or line turns when speakers and timestamps are absent", () => {
    expect(parseSpeakerTurns("First paragraph.\n\nSecond paragraph.", "txt")).toHaveLength(2);
    expect(parseSpeakerTurns("First line.\nSecond line.", "txt")).toHaveLength(2);
  });

  it("splits long turns into stable, ordered exact-substring spans", () => {
    const raw = `Alex: ${"A".repeat(3200)}`;
    const turns = parseSpeakerTurns(raw, "txt");
    const first = createSpansFromTurns(raw, turns);
    const second = createSpansFromTurns(raw, turns);
    expect(first.length).toBeGreaterThan(1);
    expect(first).toEqual(second);
    first.forEach((span, index) => {
      expect(span.spanIndex).toBe(index);
      expect(span.text).toBe(raw.slice(span.startChar, span.endChar));
      expect(span.text.length).toBeLessThanOrEqual(1500);
    });
  });
});

describe("transcript import", () => {
  it("imports a mixed transcript end to end with exact raw source spans", () => {
    const raw = `[00:00:01] Alex: We should build the transcript memory app first.
It needs source-backed spans.

[00:00:08] Baiyang: Raw transcripts should never be changed.
Evidence has to point back to exact text.

[00:00:15] Alex: If evidence is weak, Ask AI should say that.`;
    const result = importTranscript(db, { filename: "meeting.txt", rawText: raw, sourceType: "upload" });
    expect(result).toMatchObject({ status: "imported", turnsCreated: 3, spansCreated: 3 });
    const transcript = db.prepare("SELECT raw_text, raw_sha256 FROM transcripts WHERE id = ?").get(result.transcriptId) as { raw_text: string; raw_sha256: string };
    expect(transcript).toEqual({ raw_text: raw, raw_sha256: computeRawSha256(raw) });
    const spans = db.prepare("SELECT * FROM transcript_spans WHERE transcript_id = ? ORDER BY span_index").all(result.transcriptId) as Array<{ id: string; start_char: number; end_char: number; text: string }>;
    spans.forEach((span) => {
      expect(span.text).toBe(raw.slice(span.start_char, span.end_char));
      const expectedId = `sp_${createHash("sha256").update(`${result.transcriptId}:turn:${span.start_char}:${span.end_char}`).digest("hex").slice(0, 24)}`;
      expect(span.id).toBe(expectedId);
    });
  });

  it("preserves whitespace and CRLF and protects raw fields from updates", () => {
    const raw = "  Alex: hello\r\ncontinuation  \r\n";
    const result = importTranscript(db, { filename: "exact.md", rawText: raw });
    expect((db.prepare("SELECT raw_text FROM transcripts WHERE id = ?").get(result.transcriptId) as { raw_text: string }).raw_text).toBe(raw);
    const turns = db.prepare("SELECT * FROM transcript_turns WHERE transcript_id = ?").all(result.transcriptId) as Array<{ start_char: number; end_char: number; raw_text: string }>;
    turns.forEach((turn) => expect(turn.raw_text).toBe(raw.slice(turn.start_char, turn.end_char)));
    const span = db.prepare("SELECT start_line, end_line, start_char, end_char, text FROM transcript_spans WHERE transcript_id = ?").get(result.transcriptId) as { start_line: number; end_line: number; start_char: number; end_char: number; text: string };
    expect(span).toMatchObject({ start_line: 1, end_line: 2 });
    expect(span.text).toBe(raw.slice(span.start_char, span.end_char));
    expect(() => db.prepare("UPDATE transcripts SET raw_text = ? WHERE id = ?").run("changed", result.transcriptId)).toThrow();
  });

  it("detects duplicates by raw hash regardless of filename", () => {
    const first = importTranscript(db, { filename: "first.txt", rawText: "Alex: same" });
    const originalSpanIds = (db.prepare("SELECT id FROM transcript_spans ORDER BY span_index").all() as Array<{ id: string }>).map(({ id }) => id);
    const duplicate = importTranscript(db, { filename: "second.md", rawText: "Alex: same" });
    expect(duplicate).toMatchObject({ status: "duplicate", transcriptId: first.transcriptId, duplicateOfTranscriptId: first.transcriptId, turnsCreated: 0, spansCreated: 0 });
    expect((db.prepare("SELECT COUNT(*) count FROM transcripts").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) count FROM transcript_turns").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT id FROM transcript_spans ORDER BY span_index").all() as Array<{ id: string }>).map(({ id }) => id)).toEqual(originalSpanIds);
  });

  it("allows the same filename with different raw content", () => {
    expect(importTranscript(db, { filename: "same.txt", rawText: "Alex: first" }).status).toBe("imported");
    expect(importTranscript(db, { filename: "same.txt", rawText: "Alex: second" }).status).toBe("imported");
    expect((db.prepare("SELECT COUNT(*) count FROM transcripts").get() as { count: number }).count).toBe(2);
  });

  it("reuses an orphaned immutable source record", () => {
    const raw = "Alex: reusable source";
    const first = importTranscript(db, { filename: "first.txt", rawText: raw });
    const sourceId = (db.prepare("SELECT source_id FROM transcripts WHERE id = ?").get(first.transcriptId) as { source_id: string }).source_id;
    db.prepare("DELETE FROM transcripts WHERE id = ?").run(first.transcriptId);
    const second = importTranscript(db, { filename: "second.txt", rawText: raw });
    expect(second.status).toBe("imported");
    expect((db.prepare("SELECT source_id FROM transcripts WHERE id = ?").get(second.transcriptId) as { source_id: string }).source_id).toBe(sourceId);
  });

  it("imports transcripts without timestamps as usable evidence", () => {
    const raw = `Alex: We need SQLite as the source of truth.
Baiyang: Markdown should only be a view.

This paragraph has no speaker but should still become usable evidence.`;
    const result = importTranscript(db, { filename: "notes.txt", rawText: raw });
    const spans = db.prepare("SELECT * FROM transcript_spans WHERE transcript_id = ? ORDER BY span_index").all(result.transcriptId) as Array<{ start_time_ms: number | null; start_char: number; end_char: number; text: string }>;
    expect(spans.length).toBeGreaterThanOrEqual(3);
    spans.forEach((span) => {
      expect(span.start_time_ms).toBeNull();
      expect(span.text).toBe(raw.slice(span.start_char, span.end_char));
    });
  });

  it("rejects empty filenames, whitespace transcripts, and unsupported files", () => {
    expect(() => importTranscript(db, { filename: "", rawText: "text" })).toThrow(ValidationError);
    expect(() => importTranscript(db, { filename: "a.txt", rawText: " \r\n " })).toThrow(ValidationError);
    expect(() => importTranscript(db, { filename: "a.pdf", rawText: "text" })).toThrow(ValidationError);
  });
});
