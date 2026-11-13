/** Shared class lists of the admin primitives. Token utilities only (tailwind-theme.generated.css). */
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export const controlBase =
    'w-full rounded-sm border bg-raised text-ink placeholder:text-ink-3 transition-colors duration-effect-fast ease-effect-fast ' +
    'hover:border-line-strong focus-visible:border-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-disabled ' +
    'disabled:hover:border-line-control aria-[invalid=true]:border-danger';

export const controlSize = {
    sm: 'h-32 px-8 text-admin-base',
    md: 'h-40 px-12 text-admin-base',
} as const;

export type ControlSize = keyof typeof controlSize;

/** Floating surfaces: menus, popovers, listboxes. Elevation by surface step; light theme adds shadow.e2. */
export const floating = 'z-50 rounded-sm border border-line bg-overlay p-4 text-ink shadow-e2';

export const menuItem =
    'flex h-32 w-full cursor-default select-none items-center gap-8 rounded-xs px-8 text-admin-base text-ink outline-none ' +
    'data-[highlighted]:bg-hover data-[disabled]:text-ink-disabled data-[disabled]:pointer-events-none';
