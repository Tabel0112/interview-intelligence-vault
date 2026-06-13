import { getSourceLines, type SourceLine } from "./offsets.js";
import { parseTimestampRange, parseTimestampToMs } from "./parseTimestamps.js";
import type { ParsedTurn, TranscriptFormat } from "./types.js";

const timestampToken = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?`;
const prefixedLine = new RegExp(String.raw`^(?:(?:\[(${timestampToken})\]|\((${timestampToken})\)|(${timestampToken}))\s+)?([^:\r\n]{1,100}):(?:\s|$)`);
const timestampOnlyLine = new RegExp(String.raw`^(?:\[(${timestampToken})\]|\((${timestampToken})\)|(${timestampToken}))\s*`);

function normalizeSpeaker(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function marker(line: string): { speakerLabel: string | null; speakerNormalized: string | null; startTimeMs: number | null } | null {
  const speaker = line.match(prefixedLine);
  if (speaker) {
    const speakerLabel = speaker[4].trim();
    return {
      speakerLabel,
      speakerNormalized: normalizeSpeaker(speakerLabel),
      startTimeMs: parseTimestampToMs(speaker[1] ?? speaker[2] ?? speaker[3] ?? ""),
    };
  }
  const timestamp = line.match(timestampOnlyLine);
  if (timestamp) return { speakerLabel: null, speakerNormalized: null, startTimeMs: parseTimestampToMs(timestamp[1] ?? timestamp[2] ?? timestamp[3]) };
  return null;
}

function makeTurn(lines: SourceLine[], details?: ReturnType<typeof marker>, times?: { startTimeMs: number; endTimeMs: number }): ParsedTurn {
  const first = lines[0], last = lines[lines.length - 1];
  return {
    turnIndex: 0,
    speakerLabel: details?.speakerLabel ?? null,
    speakerNormalized: details?.speakerNormalized ?? null,
    startTimeMs: times?.startTimeMs ?? details?.startTimeMs ?? null,
    endTimeMs: times?.endTimeMs ?? null,
    startLine: first.number,
    endLine: last.number,
    startChar: first.start,
    endChar: last.contentEnd,
    rawText: "",
  };
}

function parseCaptions(rawText: string, lines: SourceLine[]): ParsedTurn[] {
  const turns: ParsedTurn[] = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && !lines[index].content.trim()) index++;
    if (index >= lines.length) break;
    const block: SourceLine[] = [];
    while (index < lines.length && lines[index].content.trim()) block.push(lines[index++]);
    const timingIndex = block.findIndex((line) => parseTimestampRange(line.content) != null);
    if (timingIndex < 0 || timingIndex === block.length - 1) continue;
    const body = block.slice(timingIndex + 1);
    const turn = makeTurn(body, marker(body[0].content), parseTimestampRange(block[timingIndex].content)!);
    turn.rawText = rawText.slice(turn.startChar, turn.endChar);
    turns.push(turn);
  }
  return turns.map((turn, turnIndex) => ({ ...turn, turnIndex }));
}

function parsePlain(rawText: string, lines: SourceLine[]): ParsedTurn[] {
  const hasMarkers = lines.some((line) => marker(line.content) != null);
  const hasParagraphBreaks = lines.some((line) => !line.content.trim());
  if (!hasMarkers && !hasParagraphBreaks) {
    return lines.filter((line) => line.content.trim()).map((line, turnIndex) => ({
      ...makeTurn([line]),
      turnIndex,
      rawText: rawText.slice(line.start, line.contentEnd),
    }));
  }
  const groups: Array<{ lines: SourceLine[]; details: ReturnType<typeof marker> }> = [];
  let current: SourceLine[] = [];
  let details: ReturnType<typeof marker> = null;
  const flush = () => {
    if (current.some((line) => line.content.trim())) groups.push({ lines: current, details });
    current = [];
    details = null;
  };
  for (const line of lines) {
    if (!line.content.trim()) { flush(); continue; }
    const lineMarker = marker(line.content);
    if (hasMarkers && lineMarker) { flush(); details = lineMarker; current.push(line); continue; }
    if (!hasMarkers && current.length === 0) details = null;
    current.push(line);
  }
  flush();
  return groups.map((group, turnIndex) => {
    const turn = makeTurn(group.lines, group.details);
    turn.turnIndex = turnIndex;
    turn.rawText = rawText.slice(turn.startChar, turn.endChar);
    return turn;
  });
}

export function parseSpeakerTurns(rawText: string, format: TranscriptFormat): ParsedTurn[] {
  const lines = getSourceLines(rawText);
  return format === "srt" || format === "vtt" ? parseCaptions(rawText, lines) : parsePlain(rawText, lines);
}
