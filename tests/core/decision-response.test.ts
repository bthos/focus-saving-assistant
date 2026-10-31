import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isClassificationUseful } from '../../src/core/classification.ts';
import {
  DEFAULT_CATEGORY_ITEMS,
  DEFAULT_SAFETY_LEVEL_ITEMS,
} from '../../src/core/classification-defaults.ts';
import * as thresholds from '../../src/core/decision-thresholds.ts';
import { buildDecisionRequest, type DecisionRequest } from '../../src/core/decision-request.ts';
import {
  buildErrorClassification,
  describeDecisionHttpError,
  mapDecisionToClassification,
  parseDecisionResponse,
  type DecisionMapContext,
  type DecisionParseResult,
  type ParsedDecision,
} from '../../src/core/decision-response.ts';
import { decisionFixture, probeRequest } from './helpers/decision-fixture.ts';

const fixture = decisionFixture;

function expectOk(r: DecisionParseResult): ParsedDecision & { ok: true } {
  if (!r.ok) assert.fail(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}

function expectError(r: DecisionParseResult): { code: string; message: string } {
  if (r.ok) assert.fail('expected a parse error, got ok');
  return r;
}

const defaultRequest = (): DecisionRequest =>
  buildDecisionRequest({
    url: 'https://example.com/',
    title: 'Example',
    audience: 'children',
    categories: DEFAULT_CATEGORY_ITEMS,
    safetyLevels: DEFAULT_SAFETY_LEVEL_ITEMS,
    model: 'liquid/d1.1-20261027',
  });

/** Request that also asks category_fits (the category list has no Other). */
const fitsRequest = (): DecisionRequest =>
  buildDecisionRequest({
    url: 'https://example.com/',
    title: 'Example',
    audience: 'children',
    categories: [
      { name: 'Educational', restricted: false },
      { name: 'Games', restricted: true },
    ],
    safetyLevels: DEFAULT_SAFETY_LEVEL_ITEMS,
    model: 'liquid/d1.1-20261027',
  });

type Answers = Record<string, unknown>;

/** A well-formed response for `req`: noul 0.9 everywhere, first option chosen. */
function responseFor(req: DecisionRequest, patch: (answers: Answers) => void = () => {}): Record<string, unknown> {
  const answers: Answers = {};
  for (const [id, q] of Object.entries(req.questions)) {
    if (q.type === 'noul') {
      answers[id] = { type: 'noul', noul: 0.9 };
    } else {
      const first = Object.keys(q.criteria)[0];
      answers[id] = { type: 'choice', choice: first, probabilities: { [first]: 0.9 }, confidence: 0.88 };
    }
  }
  patch(answers);
  return { model: req.model, answers, usage: { cost: 0.0001 } };
}

describe('parseDecisionResponse — real recorded responses (fixture from the probe)', () => {
  it('the fixture holds the Jev educational example plus one adversarial example per model', () => {
    assert.deepEqual(
      fixture.cases.map((c) => [c.model, c.kind]),
      [
        ['typesafe/jev-1.14-20261014', 'educational'],
        ['typesafe/jev-1.14-20261014', 'adversarial'],
        ['liquid/d1.1-20261027', 'adversarial'],
        ['baseten/joey-1-20261029', 'adversarial'],
        ['perplexity/pplx-decider-flash-v1.2-20261016', 'adversarial'],
      ],
    );
  });

  for (const c of fixture.cases) {
    it(`${c.id}: parses ok and returns exactly what the model said`, () => {
      const out = expectOk(parseDecisionResponse(c.response, probeRequest(c)));
      const a = c.response.answers;
      assert.equal(out.model, c.response.model);
      assert.equal(out.cost, c.response.usage.cost);
      assert.equal(out.answers.is_educational, a.is_educational.noul);
      assert.equal(out.answers.is_age_appropriate, a.is_age_appropriate.noul);
      assert.equal(out.answers.category.choice, a.category.choice);
      assert.equal(out.answers.safety_level.choice, a.safety_level.choice);
      assert.deepEqual(out.answers.category.probabilities, a.category.probabilities);
      assert.equal(out.answers.safety_level.confidence, a.safety_level.confidence);
      assert.equal(out.answers.category_fits, undefined, 'category_fits was not asked');
    });
  }

  it('rounded (2-decimal) and full-precision numbers are both accepted unchanged', () => {
    const jev = fixture.cases[0].response.answers.is_educational.noul as number;
    const d11 = fixture.cases[2].response.answers.is_educational.noul as number;
    assert.equal(Math.round(jev * 100) / 100, jev, 'fixture: Jev rounds to 2 decimals');
    assert.notEqual(Math.round(d11 * 100) / 100, d11, 'fixture: d1.1 returns full floats');
    for (const c of [fixture.cases[0], fixture.cases[2]]) {
      const out = expectOk(parseDecisionResponse(c.response, probeRequest(c)));
      assert.equal(out.answers.is_educational, c.response.answers.is_educational.noul);
    }
  });
});

describe('parseDecisionResponse — synthetic responses', () => {
  it('ok case returns canonical option names, the response model and the cost', () => {
    const req = defaultRequest();
    const out = expectOk(
      parseDecisionResponse(
        {
          model: 'liquid/d1.1-20261027',
          answers: {
            is_educational: { type: 'noul', noul: 0.12 },
            is_age_appropriate: { type: 'noul', noul: 0.8 },
            category: { type: 'choice', choice: 'Games', probabilities: { Games: 0.7, Video: 0.3 }, confidence: 0.7 },
            safety_level: { type: 'choice', choice: 'Medium' },
          },
          usage: { input_tokens: 800, output_tokens: 0, cost: 0.000016 },
        },
        req,
      ),
    );
    assert.equal(out.model, 'liquid/d1.1-20261027');
    assert.equal(out.cost, 0.000016);
    assert.equal(out.answers.is_educational, 0.12);
    assert.equal(out.answers.category.choice, 'Games');
    assert.deepEqual(out.answers.category.probabilities, { Games: 0.7, Video: 0.3 });
    assert.equal(out.answers.category.confidence, 0.7);
    assert.equal(out.answers.safety_level.choice, 'Medium');
    assert.equal(out.answers.safety_level.probabilities, undefined);
  });

  it('a case-insensitive option match returns the canonical option name', () => {
    const req = defaultRequest();
    const out = expectOk(
      parseDecisionResponse(
        responseFor(req, (a) => {
          a.category = { type: 'choice', choice: 'social media' };
          a.safety_level = { type: 'choice', choice: 'HIGH' };
        }),
        req,
      ),
    );
    assert.equal(out.answers.category.choice, 'Social Media');
    assert.equal(out.answers.safety_level.choice, 'High');
  });

  it('category_fits is read when it was asked', () => {
    const req = fitsRequest();
    const out = expectOk(
      parseDecisionResponse(
        responseFor(req, (a) => {
          a.category_fits = { type: 'noul', noul: 0.2 };
        }),
        req,
      ),
    );
    assert.equal(out.answers.category_fits, 0.2);
  });

  it('boundary values 0 and 1 are valid noul answers', () => {
    const req = defaultRequest();
    const out = expectOk(
      parseDecisionResponse(
        responseFor(req, (a) => {
          a.is_educational = { type: 'noul', noul: 0 };
          a.is_age_appropriate = { type: 'noul', noul: 1 };
        }),
        req,
      ),
    );
    assert.equal(out.answers.is_educational, 0);
    assert.equal(out.answers.is_age_appropriate, 1);
  });

  it('missing model -> the requested model; cost is absent when usage has no usable cost', () => {
    const req = defaultRequest();
    const noModel = responseFor(req);
    delete noModel.model;
    delete noModel.usage;
    const out = expectOk(parseDecisionResponse(noModel, req));
    assert.equal(out.model, req.model);
    assert.equal(out.cost, undefined);

    for (const cost of ['0.1', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bad = { ...responseFor(req), usage: { cost } };
      assert.equal(expectOk(parseDecisionResponse(bad, req)).cost, undefined, String(cost));
    }
    assert.equal(expectOk(parseDecisionResponse({ ...responseFor(req), model: 42 }, req)).model, req.model);
  });

  it('malformed probabilities and confidence are dropped without an error', () => {
    const req = defaultRequest();
    const out = expectOk(
      parseDecisionResponse(
        responseFor(req, (a) => {
          a.category = { type: 'choice', choice: 'Games', probabilities: { Games: 1.5 }, confidence: 7 };
          a.safety_level = { type: 'choice', choice: 'High', probabilities: 'high', confidence: 'sure' };
        }),
        req,
      ),
    );
    assert.equal(out.answers.category.probabilities, undefined);
    assert.equal(out.answers.category.confidence, undefined);
    assert.equal(out.answers.safety_level.probabilities, undefined);
    assert.equal(out.answers.safety_level.confidence, undefined);
    assert.equal(out.answers.category.choice, 'Games');
  });

  it('extra answers and extra top-level keys are ignored', () => {
    const req = defaultRequest();
    const res = { ...responseFor(req), id: 'gen-dec-1', provider: 'Liquid', extra: { a: 1 } } as Record<string, unknown>;
    (res.answers as Answers).surprise = { type: 'noul', noul: 0.5 };
    const out = expectOk(parseDecisionResponse(res, req));
    assert.equal('surprise' in out.answers, false);
  });
});

describe('parseDecisionResponse — errors', () => {
  it('a body without an answers object -> missing-answers', () => {
    const req = defaultRequest();
    assert.equal(expectError(parseDecisionResponse({}, req)).code, 'missing-answers');
    assert.equal(expectError(parseDecisionResponse({ answers: 'x' }, req)).code, 'missing-answers');
    assert.equal(expectError(parseDecisionResponse({ answers: null }, req)).code, 'missing-answers');
  });

  it('a non-object body is an error, not an exception', () => {
    const req = defaultRequest();
    for (const body of [null, undefined, 'text', 5, []]) {
      expectError(parseDecisionResponse(body, req));
    }
  });

  it('a missing requested question -> missing-answer:<id>', () => {
    const req = defaultRequest();
    for (const id of ['is_educational', 'is_age_appropriate', 'category', 'safety_level']) {
      const res = responseFor(req, (a) => {
        delete a[id];
      });
      assert.equal(expectError(parseDecisionResponse(res, req)).code, `missing-answer:${id}`);
    }
  });

  it('category_fits asked but not answered -> missing-answer:category_fits', () => {
    const req = fitsRequest();
    const res = responseFor(req, (a) => {
      delete a.category_fits;
    });
    assert.equal(expectError(parseDecisionResponse(res, req)).code, 'missing-answer:category_fits');
  });

  it('a wrong or missing answer type -> unexpected-type:<id>', () => {
    const req = defaultRequest();
    const swapped = responseFor(req, (a) => {
      a.is_educational = { type: 'choice', choice: 'x' };
    });
    assert.equal(expectError(parseDecisionResponse(swapped, req)).code, 'unexpected-type:is_educational');

    const noType = responseFor(req, (a) => {
      a.category = { choice: 'Games' };
    });
    assert.equal(expectError(parseDecisionResponse(noType, req)).code, 'unexpected-type:category');

    const wrongChoiceType = responseFor(req, (a) => {
      a.safety_level = { type: 'noul', noul: 0.5 };
    });
    assert.equal(expectError(parseDecisionResponse(wrongChoiceType, req)).code, 'unexpected-type:safety_level');
  });

  it('noul outside [0,1], NaN, infinite, non-numeric or missing -> invalid-answer:<id>', () => {
    const req = defaultRequest();
    for (const bad of [1.01, -0.01, 2, Number.NaN, Number.POSITIVE_INFINITY, '0.5', null, undefined, {}]) {
      const res = responseFor(req, (a) => {
        a.is_age_appropriate = { type: 'noul', noul: bad };
      });
      assert.equal(
        expectError(parseDecisionResponse(res, req)).code,
        'invalid-answer:is_age_appropriate',
        String(bad),
      );
    }
  });

  it('a choice that is not one of the sent options -> invalid-answer:<id>', () => {
    const req = defaultRequest();
    for (const bad of ['Gaming', '', 5, null, undefined]) {
      const res = responseFor(req, (a) => {
        a.category = { type: 'choice', choice: bad };
      });
      assert.equal(expectError(parseDecisionResponse(res, req)).code, 'invalid-answer:category', String(bad));
    }
    const levels = responseFor(req, (a) => {
      a.safety_level = { type: 'choice', choice: 'Games' };
    });
    assert.equal(expectError(parseDecisionResponse(levels, req)).code, 'invalid-answer:safety_level');
  });

  it('an option that was cut off by the 40-item cap is not a valid answer', () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ name: `Cat ${i + 1}`, restricted: false }));
    const req = buildDecisionRequest({
      url: 'https://example.com/',
      title: '',
      audience: 'children',
      categories: many,
      safetyLevels: DEFAULT_SAFETY_LEVEL_ITEMS,
      model: 'liquid/d1.1-20261027',
    });
    const res = responseFor(req, (a) => {
      a.category = { type: 'choice', choice: 'Cat 41' };
      a.category_fits = { type: 'noul', noul: 0.9 };
    });
    assert.equal(expectError(parseDecisionResponse(res, req)).code, 'invalid-answer:category');
  });

  it('every error carries a non-empty message', () => {
    assert.ok(expectError(parseDecisionResponse({}, defaultRequest())).message.length > 0);
  });
});

describe('mapDecisionToClassification', () => {
  const NOW = 1_800_000_000_000;

  function ctx(overrides: Partial<DecisionMapContext> = {}): DecisionMapContext {
    return {
      url: 'https://games.example.com/play',
      title: 'Play now',
      now: NOW,
      requestedModel: 'liquid/d1.1-20261027',
      latencyMs: 240,
      restrictedCategories: ['Games'],
      restrictedSafetyLevels: ['High'],
      explanationActive: true,
      ...overrides,
    };
  }

  function parsed(overrides: Partial<ParsedDecision['answers']> = {}, extra: Partial<ParsedDecision> = {}): ParsedDecision {
    return {
      model: 'liquid/d1.1-20261027',
      answers: {
        is_educational: 0.9,
        is_age_appropriate: 0.9,
        category: { choice: 'Games' },
        safety_level: { choice: 'Low' },
        ...overrides,
      },
      ...extra,
    };
  }

  describe('band mapping of the two noul questions (AC8)', () => {
    const table: Array<[number, boolean | null]> = [
      [0.7, true],
      [0.71, true],
      [0.3, false],
      [0.29, false],
      [0.69, null],
      [0.31, null],
      [0, false],
      [1, true],
    ];
    for (const [p, expected] of table) {
      it(`is_educational ${p} -> ${expected}`, () => {
        const c = mapDecisionToClassification(parsed({ is_educational: p }), ctx());
        assert.equal(c.isEducational, expected);
        assert.equal(c.educational, expected, 'legacy mirror');
      });
      it(`is_age_appropriate ${p} -> ${expected}`, () => {
        const c = mapDecisionToClassification(parsed({ is_age_appropriate: p }), ctx());
        assert.equal(c.isAgeAppropriate, expected);
        assert.equal(c.ageAppropriate, expected, 'legacy mirror');
      });
    }
  });

  describe('safety level (AC9)', () => {
    it('a weak choice is NOT demoted: 0.3 and 0.05 keep the model\'s level', () => {
      for (const p of [0.3, 0.05]) {
        const c = mapDecisionToClassification(
          parsed({ safety_level: { choice: 'High', probabilities: { High: p, Low: 1 - p } } }),
          ctx(),
        );
        assert.equal(c.safetyLevel, 'High', `p=${p}`);
      }
    });

    it('Unknown appears only when the model chose Unknown', () => {
      const weak = mapDecisionToClassification(
        parsed({ safety_level: { choice: 'Medium', probabilities: { Medium: 0.2 }, confidence: 0.2 } }),
        ctx(),
      );
      assert.equal(weak.safetyLevel, 'Medium');
      const unknown = mapDecisionToClassification(parsed({ safety_level: { choice: 'Unknown' } }), ctx());
      assert.equal(unknown.safetyLevel, 'Unknown');
    });

    it('decision.safetyProbability = probabilities[choice], else confidence, else null', () => {
      const withProbs = mapDecisionToClassification(
        parsed({ safety_level: { choice: 'High', probabilities: { High: 0.3, Low: 0.7 }, confidence: 0.9 } }),
        ctx(),
      );
      assert.equal(withProbs.decision?.safetyProbability, 0.3);

      const onlyConfidence = mapDecisionToClassification(
        parsed({ safety_level: { choice: 'High', confidence: 0.55 } }),
        ctx(),
      );
      assert.equal(onlyConfidence.decision?.safetyProbability, 0.55);

      const choiceMissingFromProbs = mapDecisionToClassification(
        parsed({ safety_level: { choice: 'High', probabilities: { Low: 1 }, confidence: 0.4 } }),
        ctx(),
      );
      assert.equal(choiceMissingFromProbs.decision?.safetyProbability, 0.4);

      const neither = mapDecisionToClassification(parsed({ safety_level: { choice: 'High' } }), ctx());
      assert.equal(neither.decision?.safetyProbability, null);
    });

    it('decision-thresholds has no safety-strength constant', () => {
      assert.equal('SAFETY_MIN_STRENGTH' in thresholds, false);
      assert.equal(Object.keys(thresholds).some((k) => /SAFETY/i.test(k)), false);
    });
  });

  describe('category (AC10)', () => {
    it('category_fits <= 0.3 -> Other; above it the chosen category stays', () => {
      const at = mapDecisionToClassification(parsed({ category_fits: 0.3 }), ctx());
      assert.equal(at.category, 'Other');
      const below = mapDecisionToClassification(parsed({ category_fits: 0.2 }), ctx());
      assert.equal(below.category, 'Other');
      const above = mapDecisionToClassification(parsed({ category_fits: 0.31 }), ctx());
      assert.equal(above.category, 'Games');
    });

    it('category_fits omitted -> the chosen category', () => {
      assert.equal(mapDecisionToClassification(parsed(), ctx()).category, 'Games');
    });

    it('chosen Educational -> no suggested URL and an explanatory noUrlReason', () => {
      const c = mapDecisionToClassification(parsed({ category: { choice: 'Educational' } }), ctx());
      assert.equal(c.category, 'Educational');
      assert.equal(c.suggestedUrl, null);
      assert.equal(c.suggestedEducationalResource, null);
      assert.equal(typeof c.noUrlReason, 'string');
      assert.ok((c.noUrlReason ?? '').length > 0);
    });

    it('chosen Educational in another letter case is treated the same', () => {
      const c = mapDecisionToClassification(parsed({ category: { choice: 'educational' } }), ctx());
      assert.equal(c.suggestedUrl, null);
      assert.ok((c.noUrlReason ?? '').length > 0);
    });

    it('records the chosen category probability next to the safety one', () => {
      const c = mapDecisionToClassification(
        parsed({ category: { choice: 'Games', probabilities: { Games: 0.62, Video: 0.38 } } }),
        ctx(),
      );
      assert.equal(c.decision?.categoryProbability, 0.62);
    });
  });

  describe('mapped result (AC11)', () => {
    it('is marked as a decision result with a synthesized reason', () => {
      const c = mapDecisionToClassification(parsed(), ctx());
      assert.equal(c.source, 'decision');
      assert.equal(c.reasonSource, 'synthesized');
      assert.ok(c.reason.trim().length > 0);
      assert.equal(c.error, undefined);
    });

    it('carries the response model, ctx time, url and title', () => {
      const c = mapDecisionToClassification(parsed({}, { model: 'liquid/d1.1-20261027' }), ctx({ requestedModel: 'liquid/d1.1' }));
      assert.equal(c.model, 'liquid/d1.1-20261027');
      assert.equal(c.classifiedAt, NOW);
      assert.equal(c.url, 'https://games.example.com/play');
      assert.equal(c.title, 'Play now');
    });

    it('populates the decision audit block', () => {
      const c = mapDecisionToClassification(
        parsed({ is_educational: 0.12, is_age_appropriate: 0.8, category_fits: 0.9 }, { cost: 0.000016 }),
        ctx({ requestedModel: 'liquid/d1.1', latencyMs: 311 }),
      );
      assert.deepEqual(c.decision?.probabilities, { isEducational: 0.12, isAgeAppropriate: 0.8, categoryFits: 0.9 });
      assert.equal(c.decision?.requestedModel, 'liquid/d1.1');
      assert.equal(c.decision?.model, 'liquid/d1.1-20261027');
      assert.equal(c.decision?.latencyMs, 311);
      assert.equal(c.decision?.cost, 0.000016);
    });

    it('categoryFits is absent from the audit block when it was not asked', () => {
      const c = mapDecisionToClassification(parsed(), ctx());
      assert.equal(c.decision?.probabilities && 'categoryFits' in c.decision.probabilities, false);
    });

    it('is always worth caching', () => {
      for (const choice of ['Games', 'Other', 'Educational']) {
        const c = mapDecisionToClassification(
          parsed({ category: { choice }, is_educational: 0.5, is_age_appropriate: 0.5 }),
          ctx(),
        );
        assert.equal(isClassificationUseful(c), true, choice);
      }
    });

    it('leaves the generative explanation to Stage 2: no suggestion, no generative state', () => {
      const c = mapDecisionToClassification(parsed(), ctx());
      assert.equal(c.suggestedUrl, null);
      assert.equal(c.noUrlReason, null);
      assert.equal(c.generative, undefined);
    });

    it('with Stage 2 inactive the missing explanation is explained, not left empty', () => {
      const c = mapDecisionToClassification(parsed(), ctx({ explanationActive: false }));
      assert.equal(c.noUrlReason, 'Explanation model is not configured.');
      assert.equal(c.suggestedUrl, null);
    });

    it('the synthesized reason follows the parent\'s lists (blocked category named)', () => {
      const c = mapDecisionToClassification(parsed(), ctx({ restrictedCategories: ['Games'], restrictedSafetyLevels: [] }));
      assert.ok(c.reason.includes('Games'), c.reason);
    });
  });
});

describe('describeDecisionHttpError (AC14)', () => {
  const jsonBody = (message: string): string => JSON.stringify({ error: { message, code: 0 } });

  it('401 -> key rejected', () => {
    assert.equal(
      describeDecisionHttpError(401, jsonBody('No auth credentials found')),
      'OpenRouter rejected the API key: No auth credentials found',
    );
  });

  it('402 -> insufficient credits', () => {
    assert.equal(describeDecisionHttpError(402, ''), 'OpenRouter account has insufficient credits');
  });

  it('429 -> rate limit', () => {
    assert.equal(describeDecisionHttpError(429, ''), 'OpenRouter rate limit reached');
  });

  it('400 -> "Decision model did not accept the request: <server message>" (Respan example)', () => {
    const respan =
      'Respan state must be a string or an object with only input (a message array) and output (a message)';
    assert.equal(
      describeDecisionHttpError(400, jsonBody(respan)),
      `Decision model did not accept the request: ${respan}`,
    );
  });

  it('500 and 503 -> service error with the status', () => {
    assert.equal(describeDecisionHttpError(500, ''), 'OpenRouter Decisions service error (500)');
    assert.equal(describeDecisionHttpError(503, ''), 'OpenRouter Decisions service error (503)');
  });

  it('any other status -> generic error with the status', () => {
    assert.equal(describeDecisionHttpError(418, ''), 'OpenRouter Decisions API error: 418');
  });

  it('a non-JSON body is used as the server message', () => {
    assert.equal(
      describeDecisionHttpError(502, 'Bad gateway'),
      'OpenRouter Decisions service error (502): Bad gateway',
    );
  });

  it('the server message is cut to 200 characters (plain body and JSON message)', () => {
    const plain = describeDecisionHttpError(418, 'x'.repeat(500));
    assert.equal(plain, `OpenRouter Decisions API error: 418: ${'x'.repeat(200)}`);
    const json = describeDecisionHttpError(400, jsonBody('y'.repeat(500)));
    assert.equal(json, `Decision model did not accept the request: ${'y'.repeat(200)}`);
  });

  it('the status text stays when the body is whitespace', () => {
    assert.equal(describeDecisionHttpError(429, '  \n '), 'OpenRouter rate limit reached');
  });
});

describe('buildErrorClassification (AC15)', () => {
  it('has exactly the shape the classifier returns on failure today', () => {
    assert.deepEqual(buildErrorClassification('https://a.org/x', 'A page', 'boom', 1234), {
      isEducational: null,
      category: 'error',
      reason: 'boom',
      url: 'https://a.org/x',
      title: 'A page',
      classifiedAt: 1234,
      error: true,
      educational: null,
    });
  });
});
