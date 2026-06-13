import { lineNumberAt } from "./offsets.js";
import type { ParsedSpan, ParsedTurn } from "./types.js";

const MAX_SPAN_CHARS = 1500;

function splitPoint(text: string, start: number, maxEnd: number): number {
  const window = text.slice(start, maxEnd);
  let best = -1;
  for (const match of window.matchAll(/(?:\r\n|\r|\n)|[.!?](?=\s)/g)) best = match.index! + match[0].length;
  return best >= Math.floor(MAX_SPAN_CHARS * 0.5) ? start + best : maxEnd;
}

export function createSpansFromTurns(rawText: string, turns: ParsedTurn[]): ParsedSpan[] {
  const spans: ParsedSpan[] = [];
  for (const turn of turns) {
    let startChar = turn.startChar;
    while (startChar < turn.endChar) {
      const maxEnd = Math.min(startChar + MAX_SPAN_CHARS, turn.endChar);
      const endChar = maxEnd < turn.endChar ? splitPoint(rawText, startChar, maxEnd) : turn.endChar;
      const text = rawText.slice(startChar, endChar);
      if (text.trim()) {
        spans.push({
          spanIndex: spans.length,
          kind: "turn",
          speakerLabel: turn.speakerLabel,
          startTimeMs: turn.startTimeMs,
          endTimeMs: turn.endTimeMs,
          startLine: lineNumberAt(rawText, startChar),
          endLine: lineNumberAt(rawText, endChar - 1),
          startChar,
          endChar,
          text,
        });
      }
      startChar = endChar;
    }
  }
  return spans;
}
