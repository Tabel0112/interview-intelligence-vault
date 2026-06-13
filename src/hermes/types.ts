export interface HermesAnswerStyle { verbosity: "short" | "medium" | "detailed"; tone: "direct" | "explanatory" | "technical"; citationDensity: "minimal" | "normal" | "high"; showUncertainty: boolean; }
export interface HermesDefaultFilters { transcriptIds?: string[]; dateRange?: { start?: string; end?: string }; speakerIds?: string[]; labels?: string[]; }
export interface HermesRankingPreferences { preferRecent?: boolean; preferredTopics?: string[]; preferredLabels?: string[]; boostUserCorrectedItems?: boolean; }
export interface HermesFollowupPreferences { includeSuggestedFollowups: boolean; maxFollowups: number; preferProjectContinuations: boolean; }
export interface HermesLabelPreference { id: string; label: string; description: string | null; priority: number; }
export interface HermesTopicProfile { id: string; topic: string; weight: number; source: "explicit_user_preference" | "correction_history" | "usage_pattern"; }
export interface HermesProfile { userId: string; answerStyle: HermesAnswerStyle; defaultFilters: HermesDefaultFilters; rankingPreferences: HermesRankingPreferences; suggestedFollowupPreferences: HermesFollowupPreferences; labels: HermesLabelPreference[]; topics: HermesTopicProfile[]; }
export interface HermesRankingHint { preferredTopics: string[]; preferRecent: boolean; }
export interface HermesStyleHint { answerStyle: HermesAnswerStyle; }
export interface HermesFilterHint { filters: HermesDefaultFilters; }
export interface HermesPersonalizationSummary { personalizationOnly: true; styleHints: string[]; filterHints: string[]; rankingHints: string[]; followupHints: string[]; }
