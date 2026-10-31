/**
 * Types for focus saving extension
 */

import type { ClassificationItem } from '../core/classification-defaults.ts';

export type { ClassificationItem };

export interface Settings {
  restrictedPatterns: string[];
  allowedPatterns: string[];
  ignoredPatterns: string[];
  restrictedPageMessage: string;
  aiProvider: 'github' | 'openrouter';
  aiApiToken: string;
  aiModel: string;
  aiClassificationPrompt: string;
  enableAIClassification: boolean;
  categoryItems: ClassificationItem[];
  safetyLevelItems: ClassificationItem[];
  /** @deprecated Derived from categoryItems */
  availableCategories?: string[];
  /** @deprecated Derived from categoryItems */
  restrictedCategories?: string[];
  /** @deprecated Derived from safetyLevelItems */
  availableSafetyLevels?: string[];
  /** @deprecated Derived from safetyLevelItems */
  restrictedSafetyLevels?: string[];
  telegramBotToken: string;
  telegramChatId: string;
  enableTelegramNotifications: boolean;
  enableTelegramCommands: boolean;
  telegramPollIntervalMinutes: number;
  notificationFrequency: 'instant' | 'hourly' | 'daily';
  notificationTypes: ('restricted' | 'suspicious' | 'weekly' | 'timeLimit')[];
  pageNotificationTypes: ('restricted' | 'allowed' | 'educational' | 'nonEducational')[];
  userProfileName: string;
  timeLimits: {
    enabled: boolean;
    allowedHours: {
      start: number;
      end: number;
    };
  };
  parentPassword: string;
  passwordHint: string;
  enableSystemLogs: boolean;
  decisionEnabled: boolean;
  decisionApiToken: string;
  decisionModel: string;
  aiAudience: string;
  enableAIExplanation: boolean;
  aiExplanationPrompt: string;
}

export interface VisitInfo {
  visitTime: number;
  transition: string;
  visitId?: string;
}

export interface HistoryEntry {
  id: number;
  url: string;
  title: string;
  timestamp: number;
  restricted: boolean;
  reason?: string;
  matchedPattern?: string;
  classification?: ClassificationResult;
  visits?: VisitInfo[]; // Detailed visit information from chrome.history API
  visitCount?: number; // Number of times this URL was visited
  incognito?: boolean; // True if captured from incognito mode (chrome.history API doesn't work in incognito)
}

export interface ClassificationResult {
  isEducational: boolean | null;
  category: string;
  reason: string;
  isAgeAppropriate?: boolean | null;
  safetyLevel?: string | null;
  suggestedUrl?: string | null;
  noUrlReason?: string | null;
  url?: string;
  title?: string;
  classifiedAt?: number;
  model?: string;
  error?: boolean;
  cachedAt?: number;
  // Legacy fields for backward compatibility
  educational?: boolean | null;
  ageAppropriate?: boolean | null;
  suggestedEducationalResource?: string | null;
  source?: 'decision';
  reasonSource?: 'synthesized' | 'model';
  decision?: DecisionDetails;
  generative?: GenerativeState;
}

export interface ClassificationCache {
  [domain: string]: ClassificationResult;
}

export interface UrlCheckResult {
  restricted: boolean;
  reason: 'allowed' | 'restricted' | 'permitted' | string;
  matchedPattern: string | null;
}

export interface DecisionDetails {
  requestedModel: string;
  model: string;
  probabilities: { isEducational: number; isAgeAppropriate: number; categoryFits?: number };
  categoryProbability: number | null;
  safetyProbability: number | null;
  latencyMs: number;
  cost?: number;
}

export interface TelegramNoticeRef {
  chatId: string;
  messageId: number;
  keyboardUrl: string | null;
  finalized: boolean;
  text?: string;
  fallbackText?: string;
}

export interface GenerativeState {
  status: 'pending' | 'done' | 'failed';
  attemptedAt: number;
  model?: string;
  error?: string;
  telegram?: TelegramNoticeRef;
}
