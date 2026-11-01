/**
 * Default settings for a fresh install and the base for merging stored settings.
 */

import type { Settings } from '../types/index.ts';
import { DEFAULT_CATEGORY_ITEMS, DEFAULT_SAFETY_LEVEL_ITEMS } from './classification-defaults.ts';

export const DEFAULT_SETTINGS: Settings = {
  restrictedPatterns: [],
  allowedPatterns: [],
  ignoredPatterns: [],
  restrictedPageMessage: "This site has been restricted to help you stay focused.",
  aiProvider: 'github',
  aiApiToken: "",
  aiModel: "",
  aiClassificationPrompt: "Classify if this URL/title is educational content suitable for children. URL: {url}, Title: {title}.\n\nIMPORTANT: Always provide suggestedUrl and noUrlReason. If the chosen category is Educational, set suggestedUrl to null and briefly explain in noUrlReason (e.g., \"Already educational; no alternate suggested\") — do not suggest a different educational resource. If the content is not educational, suggest an educational alternative URL that covers similar topics or themes, or null with noUrlReason if none exists (e.g., \"No suitable educational alternative found for this type of content\" or \"Content is too specific/commercial to have an educational equivalent\"). Never leave suggestedUrl as an empty string or use placeholder text.",
  enableAIClassification: true,
  categoryItems: [...DEFAULT_CATEGORY_ITEMS],
  safetyLevelItems: [...DEFAULT_SAFETY_LEVEL_ITEMS],
  telegramBotToken: "",
  telegramChatId: "",
  enableTelegramNotifications: true,
  enableTelegramCommands: false,
  telegramPollIntervalMinutes: 1,
  notificationFrequency: "instant",
  notificationTypes: ['restricted', 'suspicious', 'weekly', 'timeLimit'],
  pageNotificationTypes: ['restricted', 'nonEducational'],
  userProfileName: "",
  timeLimits: {
    enabled: false,
    allowedHours: { start: 8, end: 22 }
  },
  parentPassword: "",
  passwordHint: "Enter word \"friend\"",
  enableSystemLogs: true,
  decisionEnabled: false,
  decisionApiToken: '',
  decisionModel: '',
  aiAudience: 'children',
  enableAIExplanation: true,
  aiExplanationPrompt: 'A focus-assistant classifier blocked this page for {audience}.\nURL: {url}\nTitle: {title}\nClassification: category "{category}", risk level "{riskLevel}".\n\nExplain why this page was blocked, then suggest an educational page on a similar topic that suits {audience}.',
};
