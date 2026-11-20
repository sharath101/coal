import {
  API_BASE_PATH,
  fillPath,
  type PathValue,
  type EndpointInput,
  type EndpointOutput,
  type EndpointSpec,
} from './contract';
import { PROBLEM_CONTENT_TYPE, Problem } from './problem';

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get code() {
    return this.problem.code;
  }

  get status() {
    return this.problem.status;
  }
}

export interface ApiClientOptions {
  /** The origin the API lives on, or '' for the same origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Extra headers for every request, such as a bearer token in the app. */
  headers?: () => Record<string, string>;
}

type CallArgs<E extends EndpointSpec> =
  Record<string, never> extends EndpointInput<E>
    ? [input?: EndpointInput<E>]
    : [input: EndpointInput<E>];

export type ApiClient = <E extends EndpointSpec>(
  endpoint: E,
  ...args: CallArgs<E>
) => Promise<EndpointOutput<E>>;

/** A typed client for the COAL API, built from the endpoint contracts in shared/. */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? '';

  return async function call<E extends EndpointSpec>(endpoint: E, ...args: CallArgs<E>) {
    const input = (args[0] ?? {}) as EndpointInput<EndpointSpec> & {
      params?: Record<string, PathValue>;
      query?: Record<string, QueryValue>;
      body?: unknown;
    };
    const fetchImpl = options.fetch ?? fetch;
    const url =
      baseUrl + API_BASE_PATH + fillPath(endpoint.path, input.params) + toQuery(input.query);

    const headers: Record<string, string> = { accept: 'application/json', ...options.headers?.() };
    if (input.body !== undefined) headers['content-type'] = 'application/json';
    if (input.idempotencyKey) headers['idempotency-key'] = input.idempotencyKey;
    if (input.ifMatch) headers['if-match'] = input.ifMatch;

    const response = await fetchImpl(url, {
      method: endpoint.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      credentials: 'include',
    });

    if (!response.ok) throw new ApiError(await readProblem(response));
    if (!endpoint.response || response.status === 204) return undefined as EndpointOutput<E>;
    return endpoint.response.parse(await response.json()) as EndpointOutput<E>;
  };
}

type QueryValue = string | number | boolean | null | undefined;

function toQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** The problem a failed response carries, or one made from its status. For callers that read a response themselves, such as a stream. */
export async function readProblem(response: Response): Promise<Problem> {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes(PROBLEM_CONTENT_TYPE) || type.includes('application/json')) {
    const parsed = Problem.safeParse(await response.json().catch(() => null));
    if (parsed.success) return parsed.data;
  }
  return {
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    status: response.status,
    code: response.status === 401 ? 'NOT_SIGNED_IN' : 'INTERNAL',
  };
}
