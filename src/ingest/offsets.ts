export interface SourceLine {
  number: number;
  start: number;
  contentEnd: number;
  end: number;
  content: string;
}

export function getSourceLines(rawText: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let number = 1;
  for (let index = 0; index < rawText.length; index++) {
    if (rawText[index] !== "\n" && rawText[index] !== "\r") continue;
    const contentEnd = index;
    if (rawText[index] === "\r" && rawText[index + 1] === "\n") index++;
    const end = index + 1;
    lines.push({ number, start, contentEnd, end, content: rawText.slice(start, contentEnd) });
    start = end;
    number++;
  }
  if (start < rawText.length || rawText.length === 0) {
    lines.push({ number, start, contentEnd: rawText.length, end: rawText.length, content: rawText.slice(start) });
  }
  return lines;
}

export function lineNumberAt(rawText: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < Math.min(offset, rawText.length); index++) {
    if (rawText[index] === "\n") line++;
    else if (rawText[index] === "\r") {
      line++;
      if (rawText[index + 1] === "\n") index++;
    }
  }
  return line;
}
