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
  description?: string;
}

/** Default categories to block (subset of available) */
export const DEFAULT_RESTRICTED_CATEGORIES: string[] = [
  'Commercial',
  'Entertainment',
  'Fashion',
  'Games',
  'Retail',
  'Shopping',
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

/** Built-in descriptions by lower-cased name; they help the decision model tell the options apart. */
export const DEFAULT_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  educational: 'Teaches or explains a subject: lessons, courses, tutorials, encyclopedias, study material.',
  reference: 'Dictionaries, documentation, maps and other lookup material.',
  news: 'News articles and news outlets.',
  'social media': 'Social networks, chat and short-video feeds where people follow, like, comment and message each other (for example TikTok, Instagram, Snapchat).',
  entertainment: 'Content made mainly to entertain: streaming, memes, celebrity and pop culture.',
  games: 'Video games, game portals, browser games and game news.',
  shopping: 'Pages where you can buy things online: product listings, shopping carts, checkout and marketplaces.',
  retail: "A shop's or brand's own presence without a buying flow: store locators, opening hours, catalogs and brand pages.",
  commercial: 'Business sites mainly promoting products or services.',
  fashion: 'Clothing, style and beauty.',
  finance: 'Banking, investing, trading and cryptocurrency.',
  health: 'Medical, fitness and wellbeing information.',
  adult: 'Sexual or pornographic content, or content meant only for adults.',
  sports: 'Sports news, scores, teams and leagues.',
  technology: 'Technology news, software, gadgets and programming.',
  science: 'Science news and explanations: physics, biology, space, chemistry.',
  arts: 'Visual arts, museums, design, literature and performing arts.',
  music: 'Music streaming, artists, lyrics and instruments.',
  video: 'Pages for watching one specific video, film or stream: video players, streaming catalogs and video hosting that are not a social feed.',
  blog: 'Personal or company blogs and opinion writing.',
  forum: 'Discussion boards and question-and-answer communities.',
  government: 'Official government sites, public services and legal institutions.',
  other: 'Anything that none of the other categories describes.',
};

export const DEFAULT_SAFETY_LEVEL_DESCRIPTIONS: Record<string, string> = {
  low: 'Low risk: nothing indicates content that could harm the audience; ordinary safe content.',
  medium: 'Medium risk: mature themes, heavy advertising, lightly moderated user content, or content borderline for the audience.',
  high: 'High risk: adult, violent, gambling, drug-related, hateful or otherwise clearly harmful content for the audience, or open contact with strangers.',
  unknown: 'The address and title give too little information to judge the risk.',
};
