import { createLogger } from '../logger.js';
const log = createLogger('api');
export class ApiError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'ApiError';
    }
    static badRequest(message) {
        return new ApiError(400, 'bad_request', message);
    }
    static notFound(message) {
        return new ApiError(404, 'not_found', message);
    }
}
/**
 * Express 4 does not catch rejections from async handlers — an awaited query
 * that throws becomes an unhandled rejection and the request hangs until the
 * client times out. Every route is wrapped.
 */
export function asyncHandler(handler) {
    return (req, res, next) => {
        handler(req, res).catch(next);
    };
}
export function errorHandler(error, req, res, _next) {
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
export function notFoundHandler(req, res) {
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
export function requireAddress(value, field) {
    if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
        throw ApiError.badRequest(`"${field}" must be a 0x-prefixed 20-byte address`);
    }
    return value.toLowerCase();
}
export function requireName(value, field) {
    if (typeof value !== 'string') {
        throw ApiError.badRequest(`"${field}" is required`);
    }
    const normalized = value.trim().toLowerCase();
    if (!LABEL_RE.test(normalized)) {
        throw ApiError.badRequest(`"${field}" must be 1-63 characters of a-z, 0-9 or "-", optionally suffixed with .arc`);
    }
    return normalized;
}
export function optionalName(value, field) {
    if (value === undefined || value === '')
        return undefined;
    return requireName(value, field);
}
export function optionalLimit(value, fallback, max) {
    if (value === undefined || value === '')
        return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
        throw ApiError.badRequest(`"limit" must be an integer between 1 and ${max}`);
    }
    return parsed;
}
export function optionalCursor(value) {
    if (value === undefined || value === '')
        return undefined;
    if (typeof value !== 'string' || value.length > 128) {
        throw ApiError.badRequest('"cursor" is not a cursor returned by this API');
    }
    return value;
}
