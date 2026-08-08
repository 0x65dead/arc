import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createLogger } from '../logger.js';

const log = createLogger('api');

/**
 * Error envelope.
 *
 * Every failure — validation, not-found, unexpected — comes back as
 * `{ error: { code, message } }`, which is the shape `src/lib/indexer.ts`
 * parses to surface a useful message instead of a bare "HTTP 400". v1 returned
 * `{ error: "Failed to load stats" }` for everything and had no code at all,
 * so a client could not distinguish "you asked for something invalid" from
 * "the database is down".
 */

export type ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'internal'
  | 'unavailable'
  // Added for the waitlist routes, which unlike the chain-data ones can fail
  // in ways a client is expected to handle differently: re-sign (unauthorized),
  // show a specific message (conflict), or back off (rate_limited). Collapsing
  // these into bad_request would mean the frontend parsing message strings to
  // tell them apart.
  | 'unauthorized'
  | 'conflict'
  | 'rate_limited';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, 'bad_request', message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, 'not_found', message);
  }
}

/**
 * Express 4 does not catch rejections from async handlers — an awaited query
 * that throws becomes an unhandled rejection and the request hangs until the
 * client times out. Every route is wrapped.
 */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  // Unexpected: log the detail server-side, return something generic. The
  // message of a Postgres error can contain query fragments and is not
  // something to hand to an anonymous caller.
  log.error('unhandled error', { path: req.path, error });
  res.status(500).json({
    error: { code: 'internal', message: 'Internal error. Please retry.' },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
  });
}

// ---------------------------------------------------------------------------
// Query parameter validation
//
// Each of these throws an ApiError describing what was wrong, rather than
// coercing silently. `getDomainsByOwner('undefined')` returning an empty list
// looks identical to "this address owns nothing".
// ---------------------------------------------------------------------------

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const LABEL_RE = /^[a-z0-9-]{1,63}(\.arc)?$/;

export function requireAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
    throw ApiError.badRequest(`"${field}" must be a 0x-prefixed 20-byte address`);
  }
  return value.toLowerCase();
}

export function requireName(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw ApiError.badRequest(`"${field}" is required`);
  }
  const normalized = value.trim().toLowerCase();
  if (!LABEL_RE.test(normalized)) {
    throw ApiError.badRequest(
      `"${field}" must be 1-63 characters of a-z, 0-9 or "-", optionally suffixed with .arc`,
    );
  }
  return normalized;
}

export function optionalName(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  return requireName(value, field);
}

export function optionalLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw ApiError.badRequest(`"limit" must be an integer between 1 and ${max}`);
  }
  return parsed;
}

export function optionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 128) {
    throw ApiError.badRequest('"cursor" is not a cursor returned by this API');
  }
  return value;
}
