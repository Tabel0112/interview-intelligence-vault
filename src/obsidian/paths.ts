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

// Clean, human-readable note basename: the sanitized title with NO id suffix. Blank/missing titles fall
// back to "Untitled". Obsidian's native graph shows this basename as the node label, so it stays a clean
// human label — the short id lives in the PARENT folder (below) for uniqueness, and the FULL id stays in
// the note's frontmatter/body. `safeName` strips `/ : ? * " <> |` and control chars, so the basename can
// never introduce an accidental subfolder.
export const noteBasename = (label: string): string => safeName(labelFromText(label));

// Generated note path: "<category>/<shortId>/<clean title>.md". The short-id folder keeps distinct,
// same-titled entities apart and is deterministic from the id; the basename is a disposable, human-readable
// view and is never the only identifier. (A vanishingly rare shortId truncation collision with the same
// title is caught loudly by generateObsidianVault's path-collision guard.)
export const readableNotePath = (category: string, label: string, id: string): string => `${category}/${shortId(id)}/${noteBasename(label)}.md`;

export const memoryFolder = (type: string) => type === "decision" ? "Decisions" : type === "preference" ? "Preferences" : type === "task" ? "Tasks" : type === "question" ? "Questions" : type === "claim" ? "Facts" : "Other";
export const transcriptPath = (title: string, id: string) => readableNotePath("Transcripts", title, id);
export const memoryPath = (title: string, id: string, type: string) => readableNotePath(`Memories/${memoryFolder(type)}`, title, id);
export const evidencePath = (label: string, id: string) => readableNotePath("Evidence", label, id);
export const answerPath = (label: string, id: string) => readableNotePath("Answers", label, id);
export const conflictPath = (label: string, id: string) => readableNotePath("Conflicts", label, id);
export const entityPath = (kind: "person" | "topic" | "decision", label: string, id: string) => readableNotePath(kind === "person" ? "People" : kind === "topic" ? "Topics" : "Decisions", label, id);
export const stripMd = (path: string) => path.replace(/\.md$/i, "");
export const wikiLink = (path: string, label?: string, anchor?: string) => `[[${stripMd(path)}${anchor ? `#${anchor}` : ""}${label ? `|${label}` : ""}]]`;
