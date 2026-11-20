import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { ActionPreview, ProposalAction } from '@coal/shared';
import type { Tx } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import { callEndpoint } from '../../core/http/call';
import type { Actor, RequestContext } from '../../core/http/context';
import { implementationOf } from '../../core/http/endpoint';
import { AppError, validationFailed } from '../../core/http/errors';
import type { PdfRenderer } from '../documents/pdf';
import type { FileStorage, StagedObject } from '../files/storage';

/**
 * Storage for a preview: it reads as usual but keeps nothing, since the preview is rolled back
 * and no record will point at what it would have written.
 */
class DryStorage implements FileStorage {
  constructor(private readonly real: FileStorage) {}
  uploadUrl(key: string, options: { contentType: string; size: number; seconds: number }) {
    return this.real.uploadUrl(key, options);
  }
  inspect(key: string, maxBytes: number): Promise<StagedObject | 'missing' | 'too_large'> {
    return this.real.inspect(key, maxBytes);
  }
  async promote(): Promise<void> {}
  downloadUrl(key: string, fileName: string, seconds: number) {
    return this.real.downloadUrl(key, fileName, seconds);
  }
  async write(_key: string, bytes: Buffer) {
    return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  read(key: string): Promise<Buffer> {
    return this.real.read(key);
  }
  stream(key: string): Promise<Readable> {
    return this.real.stream(key);
  }
}

/** A preview makes no real PDF: nothing would keep it. */
const dryPdf: PdfRenderer = {
  fromDocx: async () => Buffer.from('%PDF-1.4\n% a preview keeps no PDF\n%%EOF'),
};

/** Points a refusal at the action that caused it. */
function atAction(error: unknown, index: number): unknown {
  if (!(error instanceof AppError)) return error;
  return new AppError(error.status, error.code, `Action ${index + 1}: ${error.message}`, {
    ...error.extra,
    ...(error.extra.errors && {
      errors: error.extra.errors.map((e) => ({
        ...e,
        path: e.path.startsWith('actions.') ? e.path : `actions.${index}.${e.path}`,
      })),
    }),
  });
}

export interface RunContext {
  deps: AppDeps;
  /** The person's own request: never marked "via AI" while it runs, since they confirm it. */
  ctx: RequestContext;
  actor: Actor;
  proposal: NonNullable<RequestContext['proposal']>;
}

/**
 * Runs a proposal's actions in order, inside the caller's transaction, through each endpoint's
 * own checks and handler: the same code as calling the endpoint. Returns what each did.
 */
export async function runActions(
  tx: Tx,
  run: RunContext,
  actions: ProposalAction[],
  options: { dry: boolean },
): Promise<{ previews: ActionPreview[]; outputs: unknown[] }> {
  const deps: AppDeps = {
    ...run.deps,
    // Handlers open their own transactions; inside this one, those become savepoints.
    db: tx,
    ...(options.dry && { storage: new DryStorage(run.deps.storage), pdf: dryPdf }),
  };
  const ctx: RequestContext = { ...run.ctx, viaAi: false, proposal: run.proposal };
  const previews: ActionPreview[] = [];
  const outputs: unknown[] = [];
  for (const [index, action] of actions.entries()) {
    const impl = implementationOf(action.endpoint);
    if (!impl?.describe) {
      throw validationFailed(
        `"${action.endpoint}" can't be put on an action card.`,
        `actions.${index}.endpoint`,
      );
    }
    // The proposal is the preview: its actions always run for real, inside this transaction.
    const { preview: _preview, ...query } = action.query;
    try {
      const { output, input } = await callEndpoint(
        impl,
        deps,
        ctx,
        run.actor,
        { params: action.params, query, body: action.body, ifMatch: action.ifMatch },
        `actions.${index}`,
      );
      previews.push({
        endpoint: impl.endpoint.id,
        ...impl.describe(output as never, input as never),
      });
      outputs.push(output);
    } catch (error) {
      throw atAction(error, index);
    }
  }
  return { previews, outputs };
}

/** What the actions would do together, worked out by doing them and rolling everything back. */
export async function previewActions(
  run: RunContext,
  actions: ProposalAction[],
): Promise<ActionPreview[]> {
  const rollback = new Error('preview');
  const outcome: { previews: ActionPreview[] } = { previews: [] };
  try {
    await run.deps.db.transaction(async (tx) => {
      outcome.previews = (await runActions(tx, run, actions, { dry: true })).previews;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return outcome.previews;
}
