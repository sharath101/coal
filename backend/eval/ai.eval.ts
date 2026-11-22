import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config';
import { createProvider } from '../src/modules/ai/gateway';
import { PROMPT_VERSION } from '../src/modules/ai/prompts';
import { createTestApp, type TestApp } from '../test/helpers';
import { CRITICAL, casesFor } from './cases';
import { RecordingProvider } from './observe';
import { report, summarise, toBaseline, verdict, type Baseline } from './report';
import { aggregate, runCase, type CaseResult, type EvalEnv } from './run';
import { buildEvalWorld } from './world';

/**
 * The AI's exam, run by hand against the real model (docs/ai-safety.md#how-we-test-it):
 *
 *   pnpm eval:ai
 *
 * It needs the services up (pnpm db:up) and the AI set up in .env, and it costs money, so it is
 * not part of CI. Settings, all optional:
 *
 *   EVAL_ONLY=leak,trick     only these groups or case ids (such a run cannot clear a release)
 *   EVAL_REPEAT=3            run each case three times; a leak must hold every time
 *   EVAL_SAVE_BASELINE=1     after a run that may go, keep its score as this model's baseline
 *   EVAL_TEMPLATE_FILLING=true  also run the questions that need filling templates in COAL, which
 *                            is parked: COAL ships with it off, and so does the exam by default
 */
const root = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(root)) process.loadEnvFile(root);

const dir = fileURLToPath(new URL('.', import.meta.url));
const baselineFile = `${dir}baseline.json`;
const resultsDir = `${dir}results`;

const only = (process.env.EVAL_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 1));
const filling = process.env.EVAL_TEMPLATE_FILLING === 'true';
const runnable = casesFor(filling);
const selected = runnable.filter(
  (c) => only.length === 0 || only.includes(c.id) || only.includes(c.group),
);

const aiSettings = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => /^(AI_|ANTHROPIC_|COPILOT_)/.test(key)),
) as Record<string, string>;
// One person asks many questions in a run: the day's budget must not stop it.
aiSettings.AI_DAILY_BUDGET_USD = '1000';
aiSettings.TEMPLATE_FILLING = String(filling);

let t: TestApp;
let env: EvalEnv;
const results: CaseResult[] = [];

beforeAll(async () => {
  const provider = createProvider(
    loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused', ...aiSettings }),
  );
  if (!provider) {
    throw new Error('The AI is not set up: set AI_PROVIDER and its key in .env, then run again.');
  }
  const recorder = new RecordingProvider(provider);
  t = await createTestApp(aiSettings, { ai: recorder });
  const { w, facts } = await buildEvalWorld(t);
  env = { t, w, facts, recorder };
}, 180_000);

afterAll(async () => {
  await t?.close();
});

describe('the AI exam', () => {
  for (const c of selected) {
    it(`${c.group}: ${c.id}`, async () => {
      const runs = [];
      for (let i = 0; i < repeat; i++) runs.push(await runCase(env, c));
      const result = aggregate(c, runs);
      results.push(result);
      if (CRITICAL.includes(c.group)) {
        expect(result.failed, `${c.about}. It said: ${result.example.reply.slice(0, 400)}`).toEqual(
          [],
        );
      }
    }, 600_000);
  }

  it('reaches the release bar', () => {
    const summary = summarise(results, runnable.length);
    const model = `${env.recorder.name}:${env.recorder.model}`;
    const baselines = (
      existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : {}
    ) as Baseline;
    const v = verdict(summary, baselines[model] ?? null);

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      `${resultsDir}/latest.json`,
      JSON.stringify(
        { model, promptVersion: PROMPT_VERSION, repeat, summary, verdict: v, results },
        null,
        2,
      ),
    );
    const note = baselines[model]
      ? ''
      : `\nNo baseline for ${model} yet: only the floor applies. After a good run, EVAL_SAVE_BASELINE=1 keeps this score.`;
    console.log(
      `\n${model}, instructions ${PROMPT_VERSION}\n${report(results, summary, v)}${note}`,
    );

    if (process.env.EVAL_SAVE_BASELINE && v.release) {
      baselines[model] = toBaseline(summary, PROMPT_VERSION, new Date().toISOString().slice(0, 10));
      writeFileSync(baselineFile, `${JSON.stringify(baselines, null, 2)}\n`);
      console.log(`Saved the baseline for ${model}.`);
    }

    // A run of some cases can only find problems; a whole run decides the release.
    if (summary.complete) expect(v.reasons).toEqual([]);
    else expect(summary.failedCritical).toEqual([]);
  });
});
