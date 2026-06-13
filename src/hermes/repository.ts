import type { SqliteDatabase } from "../db/connection.js";
import { ValidationError } from "../db/errors.js";
import { createId } from "../db/ids.js";
import type { HermesAnswerStyle, HermesDefaultFilters, HermesFollowupPreferences, HermesProfile, HermesRankingPreferences } from "./types.js";

const defaults = {
  answerStyle: { verbosity: "medium", tone: "direct", citationDensity: "normal", showUncertainty: true } as HermesAnswerStyle,
  filters: {} as HermesDefaultFilters,
  ranking: {} as HermesRankingPreferences,
  followups: { includeSuggestedFollowups: true, maxFollowups: 3, preferProjectContinuations: false } as HermesFollowupPreferences,
};
const safe = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };

export function createHermesRepository(db: SqliteDatabase, options: { now?: () => Date } = {}) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const ensure = (userId: string) => {
    const timestamp = now();
    db.prepare(`INSERT OR IGNORE INTO hermes_profiles(user_id,answer_style_json,default_filters_json,ranking_preferences_json,suggested_followup_preferences_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(userId, JSON.stringify(defaults.answerStyle), JSON.stringify(defaults.filters), JSON.stringify(defaults.ranking), JSON.stringify(defaults.followups), timestamp, timestamp);
  };
  const getHermesProfile = (userId: string): HermesProfile | null => {
    const row = db.prepare("SELECT * FROM hermes_profiles WHERE user_id=?").get(userId) as Record<string, string> | undefined;
    if (!row) return null;
    const labels = db.prepare("SELECT id,label,description,priority FROM hermes_label_preferences WHERE user_id=? ORDER BY priority DESC,label").all(userId) as HermesProfile["labels"];
    const topics = db.prepare("SELECT id,topic,weight,source FROM hermes_topic_profiles WHERE user_id=? ORDER BY weight DESC,topic").all(userId) as HermesProfile["topics"];
    return { userId, answerStyle: safe(row.answer_style_json, defaults.answerStyle), defaultFilters: safe(row.default_filters_json, defaults.filters), rankingPreferences: safe(row.ranking_preferences_json, defaults.ranking), suggestedFollowupPreferences: safe(row.suggested_followup_preferences_json, defaults.followups), labels, topics };
  };
  const update = (userId: string, field: string, value: unknown) => { ensure(userId); db.prepare(`UPDATE hermes_profiles SET ${field}=?,updated_at=? WHERE user_id=?`).run(JSON.stringify(value), now(), userId); return getHermesProfile(userId)!; };
  return {
    getHermesProfile,
    createDefaultHermesProfile(userId: string): HermesProfile { ensure(userId); return getHermesProfile(userId)!; },
    upsertAnswerStyle(userId: string, value: HermesAnswerStyle) { return update(userId, "answer_style_json", value); },
    upsertDefaultFilters(userId: string, value: HermesDefaultFilters) { return update(userId, "default_filters_json", value); },
    upsertRankingPreferences(userId: string, value: HermesRankingPreferences) { return update(userId, "ranking_preferences_json", value); },
    upsertFollowupPreferences(userId: string, value: HermesFollowupPreferences) { if (value.maxFollowups < 0) throw new ValidationError("maxFollowups must be non-negative"); return update(userId, "suggested_followup_preferences_json", value); },
    upsertLabelPreference(userId: string, input: { label: string; description?: string; priority?: number }) { ensure(userId); const timestamp = now(); db.prepare(`INSERT INTO hermes_label_preferences(id,user_id,label,description,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id,label) DO UPDATE SET description=excluded.description,priority=excluded.priority,updated_at=excluded.updated_at`).run(createId("hl_"), userId, input.label, input.description ?? null, input.priority ?? 0, timestamp, timestamp); return getHermesProfile(userId)!; },
    upsertTopicProfile(userId: string, input: { topic: string; weight: number; source: HermesProfile["topics"][number]["source"] }) { if (input.weight < 0 || input.weight > 1) throw new ValidationError("Hermes topic weight must be between 0 and 1"); ensure(userId); const timestamp = now(); db.prepare(`INSERT INTO hermes_topic_profiles(id,user_id,topic,weight,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id,topic,source) DO UPDATE SET weight=excluded.weight,updated_at=excluded.updated_at`).run(createId("ht_"), userId, input.topic, input.weight, input.source, timestamp, timestamp); return getHermesProfile(userId)!; },
    recordCorrectionHistory(userId: string, input: { targetType: string; targetId: string; correctionType: "style" | "label" | "filter" | "ranking_preference" | "factual_correction"; summary: string; metadata?: Record<string, unknown> }) { ensure(userId); const id = createId("hc_"); db.prepare("INSERT INTO hermes_correction_history(id,user_id,target_type,target_id,correction_type,summary,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)").run(id, userId, input.targetType, input.targetId, input.correctionType, input.summary, JSON.stringify(input.metadata ?? {}), now()); return id; },
    listCorrectionHistory(userId: string) { return db.prepare("SELECT * FROM hermes_correction_history WHERE user_id=? ORDER BY created_at,id").all(userId) as Array<Record<string, unknown>>; },
  };
}
