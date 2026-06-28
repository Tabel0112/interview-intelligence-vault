export function safeName(value: string, fallback = "Untitled"): string {
  const clean = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  return (clean || fallback).slice(0, 100);
}
// Trim free text into a short, single-line, deterministic label for a human-readable filename.
export const labelFromText = (text: string | null | undefined, max = 60): string => {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max), lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
};

// Short, STABLE id suffix for readable filenames: keep the type prefix (ask_/evp_/mem_/tr_) plus a few
// body chars. Deterministic from the id; a (vanishingly rare) truncation collision is caught loudly by
// generateObsidianVault's path-collision guard rather than silently corrupting a note.
export const shortId = (id: string, bodyChars = 6): string => {
  const sep = id.indexOf("_");
  return sep > 0 && sep < id.length - 1
    ? `${id.slice(0, sep + 1)}${id.slice(sep + 1, sep + 1 + bodyChars)}`
    : id.slice(0, bodyChars + 4);
};

// Readable note basename: "<safe title> - <shortId>". Blank/missing titles fall back to "Untitled", and
// distinct entities that share a title stay distinct via the id suffix. The FULL id lives in the note's
// frontmatter/body — the filename is a disposable, human-readable view, never the only identifier.
export const readableNoteName = (label: string, id: string): string => `${safeName(labelFromText(label))} - ${shortId(id)}`;

export const transcriptPath = (title: string, id: string) => `Transcripts/${readableNoteName(title, id)}.md`;
export const memoryFolder = (type: string) => type === "decision" ? "Decisions" : type === "preference" ? "Preferences" : type === "task" ? "Tasks" : type === "question" ? "Questions" : type === "claim" ? "Facts" : "Other";
export const memoryPath = (title: string, id: string, type: string) => `Memories/${memoryFolder(type)}/${readableNoteName(title, id)}.md`;
export const evidencePath = (label: string, id: string) => `Evidence/${readableNoteName(label, id)}.md`;
export const answerPath = (label: string, id: string) => `Answers/${readableNoteName(label, id)}.md`;
export const conflictPath = (label: string, id: string) => `Conflicts/${readableNoteName(label, id)}.md`;
export const entityPath = (kind: "person" | "topic" | "decision", label: string, id: string) => `${kind === "person" ? "People" : kind === "topic" ? "Topics" : "Decisions"}/${readableNoteName(label, id)}.md`;
export const stripMd = (path: string) => path.replace(/\.md$/i, "");
export const wikiLink = (path: string, label?: string, anchor?: string) => `[[${stripMd(path)}${anchor ? `#${anchor}` : ""}${label ? `|${label}` : ""}]]`;
