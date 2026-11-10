import { route } from 'ziggy-js';

/** Whether a named route exists in this build (Ziggy). Navigation hides entries of modules that are not built yet. */
export function hasRoute(name: string): boolean {
    try {
        return route().has(name as never);
    } catch {
        return false;
    }
}

/** URL of a named route, or the fallback path when the route is not registered (yet). */
export function routeOr(name: string, fallback: string, params?: Record<string, string | number>): string {
    if (!hasRoute(name)) return fallback;
    return params === undefined ? route(name as never) : route(name as never, params as never);
}

export function isCurrentRoute(pattern: string): boolean {
    try {
        return route().current(pattern as never);
    } catch {
        return false;
    }
}

/** ADM-01. With Fortify's views on the sign-in route is "login"; "admin.login" only exists while they are off. */
export function loginUrl(): string {
    if (hasRoute('login')) return routeOr('login', '/admin/login');
    return routeOr('admin.login', '/admin/login');
}
