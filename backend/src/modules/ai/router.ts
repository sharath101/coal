import { AI_INTENTS, type AiRoute } from '@coal/shared';
import { z } from 'zod';
import { structured, type CallScope } from './gateway';
import type { AiCall } from '@coal/shared';
import {
  modelName,
  purposeFor,
  resolvePurpose,
  PURPOSES,
  type PurposeKey,
  type ResolvedPurpose,
} from './models';

/**
 * The router: the cheapest model reads each message and says what kind of work it is, which
 * picks the purpose and so the model (models.ts). It also names a new chat.
 */

const RouterOutput = z.object({
  intent: z.enum(AI_INTENTS),
  complex: z.boolean(),
  /** The route step the message is about, such as "2" or "24a", or "". */
  stepKey: z.string(),
  title: z.string(),
  reason: z.string(),
});

const SYSTEM = `You route messages for COAL, the R&D assistant at Jayon (an orthopaedic implant maker). Read the person's latest message (with a little earlier context) and classify it. Answer only in the schema.

intent:
- chat: greetings, thanks, help with COAL itself, anything needing no records.
- lookup: a simple fact from records: "what's waiting on me", "status of SPN-26-001", "who's on the team", "what does step 5 need".
- analysis: needs several records and reasoning: "which Spine projects are late and why", "compare", "what's blocking", "summarise everything this week".
- idea: the VP describes a new product idea or wants to start a project.
- assign: asking for someone to do something, assigning or reassigning work, changing a team, starting or submitting a step, recording a milestone.
- draft: write, create, prepare or fill a document, form, plan, report or "sample doc".
- explain: explain, review or check a document, template or draft ("what am I signing", "is anything missing").

complex: true only when the work clearly needs careful multi-step judgment beyond a typical request of that kind.
stepKey: the R&D route step the message is about if it names or clearly implies one (e.g. "market survey" → "2", "project initiation document" → "1", "action plan" → "5", "test plan" → "13", "production transfer" → "24a"), else "".
title: a 2 to 5 word title for the chat, in the person's language.
reason: one short sentence on why.`;

export interface Routed {
  route: AiRoute;
  purpose: ResolvedPurpose;
  stepKey: string | null;
  title: string;
  call: AiCall | null;
}

export async function routeMessage(
  scope: CallScope,
  text: string,
  recent: string,
  override?: string,
): Promise<Routed> {
  const overrides = scope.deps.config.ai.modelOverrides;
  if (override && override in PURPOSES) {
    const purpose = resolvePurpose(override as PurposeKey, overrides);
    return {
      purpose,
      stepKey: null,
      title: text.slice(0, 40),
      call: null,
      route: {
        intent: 'chat',
        purpose: purpose.key,
        model: purpose.model,
        modelName: modelName(purpose.model),
        effort: purpose.effort,
        reason: 'Chosen by you',
      },
    };
  }
  const router = resolvePurpose('route', overrides);
  const { value, call } = await structured(scope, router, {
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${recent ? `Earlier in the chat:\n${recent}\n\n` : ''}Latest message:\n${text}`,
      },
    ],
    schema: RouterOutput,
  });
  const purpose = resolvePurpose(purposeFor(value.intent, value.complex), overrides);
  return {
    purpose,
    stepKey: value.stepKey.trim() || null,
    title: value.title.trim(),
    call,
    route: {
      intent: value.intent,
      purpose: purpose.key,
      model: purpose.model,
      modelName: modelName(purpose.model),
      effort: purpose.effort,
      reason: value.reason,
    },
  };
}
