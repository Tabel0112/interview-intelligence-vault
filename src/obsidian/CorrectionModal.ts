import { Modal, Notice, type App } from "obsidian";
import type { CorrectionDraft, FrontendApi } from "../frontend/index.js";

export class CorrectionModal extends Modal {
  constructor(app: App, private readonly api: FrontendApi, private readonly target: Pick<CorrectionDraft, "targetType" | "targetId">) { super(app); }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Append-only correction" });
    this.contentEl.createEl("p", { text: "This records a correction separately. Raw transcript text and evidence scores are not edited." });
    const correction = this.contentEl.createEl("textarea", { attr: { "aria-label": "Correction text" } });
    const reason = this.contentEl.createEl("input", { attr: { "aria-label": "Optional reason", placeholder: "Optional reason" } });
    const result = this.contentEl.createDiv();
    const submit = this.contentEl.createEl("button", { text: "Submit correction" });
    submit.addEventListener("click", () => void (async () => {
      try {
        const saved = await this.api.submitCorrection({ ...this.target, correctionText: correction.value, reason: reason.value || undefined });
        result.setText(`Correction received: ${saved.correctionId}`);
        new Notice("Correction received for review.");
      } catch (error) {
        result.setText(error instanceof Error ? error.message : String(error));
      }
    })());
  }

  onClose(): void { this.contentEl.empty(); }
}
