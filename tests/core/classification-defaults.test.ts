import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_AVAILABLE_CATEGORIES,
  DEFAULT_AVAILABLE_SAFETY_LEVELS,
  DEFAULT_CATEGORY_DESCRIPTIONS,
  DEFAULT_CATEGORY_ITEMS,
  DEFAULT_RESTRICTED_CATEGORIES,
  DEFAULT_RESTRICTED_SAFETY_LEVELS,
  DEFAULT_SAFETY_LEVEL_DESCRIPTIONS,
  DEFAULT_SAFETY_LEVEL_ITEMS,
} from '../../src/core/classification-defaults.ts';
import { resolveItemDescription } from '../../src/core/decision-request.ts';

describe('default restricted categories (D-11, new installs)', () => {
  it('contain Shopping next to the existing ones', () => {
    assert.ok(DEFAULT_RESTRICTED_CATEGORIES.includes('Shopping'));
    for (const name of ['Commercial', 'Entertainment', 'Fashion', 'Games', 'Retail', 'Social Media']) {
      assert.ok(DEFAULT_RESTRICTED_CATEGORIES.includes(name), name);
    }
  });

  it('the default category items mark exactly the restricted names as restricted', () => {
    const restricted = DEFAULT_CATEGORY_ITEMS.filter((i) => i.restricted).map((i) => i.name).sort();
    assert.deepEqual(restricted, [...DEFAULT_RESTRICTED_CATEGORIES].sort());
    assert.equal(DEFAULT_CATEGORY_ITEMS.find((i) => i.name === 'Shopping')?.restricted, true);
  });

  it('every restricted default is an available default, and the list of 23 names is unchanged', () => {
    for (const name of DEFAULT_RESTRICTED_CATEGORIES) assert.ok(DEFAULT_AVAILABLE_CATEGORIES.includes(name), name);
    assert.equal(DEFAULT_AVAILABLE_CATEGORIES.length, 23);
  });

  it('the safety defaults still block Medium and High only', () => {
    assert.deepEqual([...DEFAULT_RESTRICTED_SAFETY_LEVELS].sort(), ['High', 'Medium']);
    assert.deepEqual(
      DEFAULT_SAFETY_LEVEL_ITEMS.filter((i) => i.restricted).map((i) => i.name).sort(),
      ['High', 'Medium'],
    );
  });
});

describe('built-in descriptions', () => {
  it('the four sharpened category descriptions equal the spec table', () => {
    assert.equal(
      DEFAULT_CATEGORY_DESCRIPTIONS['shopping'],
      'Pages where you can buy things online: product listings, shopping carts, checkout and marketplaces.',
    );
    assert.equal(
      DEFAULT_CATEGORY_DESCRIPTIONS['retail'],
      "A shop's or brand's own presence without a buying flow: store locators, opening hours, catalogs and brand pages.",
    );
    assert.equal(
      DEFAULT_CATEGORY_DESCRIPTIONS['social media'],
      'Social networks, chat and short-video feeds where people follow, like, comment and message each other (for example TikTok, Instagram, Snapchat).',
    );
    assert.equal(
      DEFAULT_CATEGORY_DESCRIPTIONS['video'],
      'Pages for watching one specific video, film or stream: video players, streaming catalogs and video hosting that are not a social feed.',
    );
  });

  it('the same four are what the request builder resolves for the built-in items', () => {
    const resolve = (name: string): string => resolveItemDescription({ name, restricted: true }, 'category');
    assert.equal(resolve('Shopping'), DEFAULT_CATEGORY_DESCRIPTIONS['shopping']);
    assert.equal(resolve('Retail'), DEFAULT_CATEGORY_DESCRIPTIONS['retail']);
    assert.equal(resolve('Social Media'), DEFAULT_CATEGORY_DESCRIPTIONS['social media']);
    assert.equal(resolve('Video'), DEFAULT_CATEGORY_DESCRIPTIONS['video']);
  });

  it('every default category and safety level has a non-empty description of its own', () => {
    for (const name of DEFAULT_AVAILABLE_CATEGORIES) {
      const text = DEFAULT_CATEGORY_DESCRIPTIONS[name.toLowerCase()];
      assert.ok(typeof text === 'string' && text.trim().length > 0, `category ${name}`);
      assert.notEqual(text, name, `category ${name} must say more than its name`);
    }
    for (const name of DEFAULT_AVAILABLE_SAFETY_LEVELS) {
      const text = DEFAULT_SAFETY_LEVEL_DESCRIPTIONS[name.toLowerCase()];
      assert.ok(typeof text === 'string' && text.trim().length > 0, `safety level ${name}`);
      assert.notEqual(text, name, `safety level ${name} must say more than its name`);
    }
  });

  it('Shopping and Retail descriptions differ on the buying flow, so the model can tell them apart', () => {
    assert.match(DEFAULT_CATEGORY_DESCRIPTIONS['shopping'], /buy/i);
    assert.match(DEFAULT_CATEGORY_DESCRIPTIONS['retail'], /without a buying flow/i);
  });

  it('the descriptions fit the description limit used for custom items', () => {
    for (const text of [...Object.values(DEFAULT_CATEGORY_DESCRIPTIONS), ...Object.values(DEFAULT_SAFETY_LEVEL_DESCRIPTIONS)]) {
      assert.ok(text.length <= 200, text);
    }
  });
});
