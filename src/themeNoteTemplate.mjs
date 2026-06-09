export const RELATED_EVIDENCE_START =
  "<!-- GENERATED:RELATED_EVIDENCE:START -->";
export const RELATED_EVIDENCE_END =
  "<!-- GENERATED:RELATED_EVIDENCE:END -->";
export const RELATED_TOPICS_START =
  "<!-- GENERATED:RELATED_TOPICS:START -->";
export const RELATED_TOPICS_END =
  "<!-- GENERATED:RELATED_TOPICS:END -->";

function yamlString(value) {
  return JSON.stringify(String(value));
}

function generatedSection(start, end, links) {
  return [start, "", ...links.map((link) => `* ${link}`), "", end].join("\n");
}

export function renderGeneratedThemeSections({ evidenceLinks, topicLinks }) {
  return [
    "## Related Evidence",
    "",
    generatedSection(RELATED_EVIDENCE_START, RELATED_EVIDENCE_END, evidenceLinks),
    "",
    "## Related Topics",
    "",
    generatedSection(RELATED_TOPICS_START, RELATED_TOPICS_END, topicLinks),
  ].join("\n");
}

export function renderThemeNote({ theme, evidenceLinks, topicLinks }) {
  const lines = [
    "---",
    "type: theme",
    `theme_id: ${theme.canonical_tag}`,
    `title: ${yamlString(theme.theme_title)}`,
    `canonical_tag: ${theme.canonical_tag}`,
    ...(theme.aliases.length > 0
      ? ["aliases:", ...theme.aliases.map((alias) => `  - ${alias}`)]
      : ["aliases: []"]),
    "status: official",
    "---",
    "",
    `# ${theme.theme_title}`,
    "",
    "## Definition",
    "",
    theme.definition,
    "",
    renderGeneratedThemeSections({ evidenceLinks, topicLinks }),
    "",
  ];
  return lines.join("\n");
}

export function wikilinkFromNotePath(notePath) {
  const normalized = String(notePath).replaceAll("\\", "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  const noteName = fileName.toLowerCase().endsWith(".md")
    ? fileName.slice(0, -3)
    : fileName;
  return `[[${noteName}]]`;
}
