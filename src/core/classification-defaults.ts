/**
 * Default categories and safety levels for AI content classification.
 * Used on first install; user can customize in settings.
 * Model must return ONLY values from these lists.
 */

export const DEFAULT_AVAILABLE_CATEGORIES: string[] = [
  'Educational',
  'Reference',
  'News',
  'Social Media',
  'Entertainment',
  'Games',
  'Shopping',
  'Retail',
  'Commercial',
  'Fashion',
  'Finance',
  'Health',
  'Adult',
  'Sports',
  'Technology',
  'Science',
  'Arts',
  'Music',
  'Video',
  'Blog',
  'Forum',
  'Government',
  'Other',
];

export const DEFAULT_AVAILABLE_SAFETY_LEVELS: string[] = [
  'Low',
  'Medium',
  'High',
  'Unknown',
];

export interface ClassificationItem {
  name: string;
  restricted: boolean;
}

/** Default categories to block (subset of available) */
export const DEFAULT_RESTRICTED_CATEGORIES: string[] = [
  'Commercial',
  'Entertainment',
  'Fashion',
  'Games',
  'Retail',
  'Social Media',
];

/** Default safety levels to block */
export const DEFAULT_RESTRICTED_SAFETY_LEVELS: string[] = [
  'Medium',
  'High',
];


/** Default category items (name + restricted). New items default to restricted. */
export const DEFAULT_CATEGORY_ITEMS: ClassificationItem[] = DEFAULT_AVAILABLE_CATEGORIES.map(
  (name) => ({
    name,
    restricted: DEFAULT_RESTRICTED_CATEGORIES.includes(name),
  })
);

/** Default safety level items */
export const DEFAULT_SAFETY_LEVEL_ITEMS: ClassificationItem[] = DEFAULT_AVAILABLE_SAFETY_LEVELS.map(
  (name) => ({
    name,
    restricted: DEFAULT_RESTRICTED_SAFETY_LEVELS.includes(name),
  })
);
