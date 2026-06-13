export function safeName(value: string, fallback = "Untitled"): string {
  const clean = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  return (clean || fallback).slice(0, 100);
}
export const stableNoteName = (label: string, id: string) => `${safeName(label)}--${safeName(id)}`;
export const transcriptPath = (title: string, id: string) => `Transcripts/${stableNoteName(title, id)}.md`;
export const memoryFolder = (type: string) => type === "decision" ? "Decisions" : type === "preference" ? "Preferences" : type === "task" ? "Tasks" : type === "question" ? "Questions" : type === "claim" ? "Facts" : "Other";
export const memoryPath = (title: string, id: string, type: string) => `Memories/${memoryFolder(type)}/${stableNoteName(title, id)}.md`;
export const evidencePath = (id: string) => `Evidence/${safeName(id)}.md`;
export const answerPath = (id: string) => `Answers/${safeName(id)}.md`;
export const conflictPath = (id: string) => `Conflicts/${safeName(id)}.md`;
export const entityPath = (kind: "person" | "topic" | "decision", label: string, id: string) => `${kind === "person" ? "People" : kind === "topic" ? "Topics" : "Decisions"}/${stableNoteName(label, id)}.md`;
export const stripMd = (path: string) => path.replace(/\.md$/i, "");
export const wikiLink = (path: string, label?: string, anchor?: string) => `[[${stripMd(path)}${anchor ? `#${anchor}` : ""}${label ? `|${label}` : ""}]]`;
