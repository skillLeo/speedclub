import { HttpCancelledError, HttpResponseError, http } from '@inertiajs/core';

/**
 * JSON requests outside Inertia visits (palette suggestions, Fortify's two-factor steps, keep-alive). Uses Inertia's HTTP client, so the
 * XSRF cookie travels the same way.
 */
export class JsonError extends Error {
    constructor(
        readonly status: number,
        readonly body: Record<string, unknown>,
    ) {
        super(`HTTP ${status}`);
    }

    /** First validation message of a field, if any. */
    field(name: string): string | null {
        const errors = this.body.errors;
        if (typeof errors !== 'object' || errors === null) return null;
        const value = (errors as Record<string, unknown>)[name];
        if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
        return typeof value === 'string' ? value : null;
    }
}

/**
 * True for a request that was aborted (a newer one replaced it, or the component went away). Inertia's client rejects it with
 * HttpCancelledError, a fetch with an AbortError DOMException. Such a request says nothing about the current one: never an error state.
 */
export function isCancelled(error: unknown): boolean {
    return error instanceof HttpCancelledError || (error instanceof DOMException && error.name === 'AbortError');
}

function parse(data: string): Record<string, unknown> {
    if (data === '') return {};
    try {
        const parsed: unknown = JSON.parse(data);
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { value: parsed };
    } catch {
        return {};
    }
}

export async function requestJson<T = Record<string, unknown>>(
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
    data?: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<T> {
    try {
        const response = await http.getClient().request({
            method,
            url,
            data: method === 'get' ? undefined : (data ?? {}),
            params: method === 'get' ? data : undefined,
            headers: { Accept: 'application/json' },
            signal,
        });
        return parse(response.data) as T;
    } catch (error) {
        if (error instanceof HttpResponseError) {
            throw new JsonError(error.response.status, parse(error.response.data));
        }
        throw error;
    }
}
