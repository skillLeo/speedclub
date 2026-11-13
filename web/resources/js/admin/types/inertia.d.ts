import '@inertiajs/core';

export interface SharedStaff {
    id: number;
    name: string;
    email: string;
    roles: string[];
    permissions: string[];
    two_factor_confirmed: boolean;
    /** This session skipped ADM-03 (STAFF_2FA_REQUIRED=false) and TOTP is still not confirmed: the shell shows the reminder. */
    two_factor_skipped?: boolean;
    /** ISO 8601; null when the password was not confirmed within the last 5 minutes (ADR-215). */
    password_confirmed_until: string | null;
}

export interface SharedApp {
    env: string;
    version: string | null;
    locale: 'de' | 'en';
    idle_minutes: number;
    warn_minutes: number;
}

export interface ApprovalFlash {
    id: string;
    title: string;
    expires_at: string;
    /** The same request was pending already (review N-1). */
    existing?: boolean;
}

export interface SharedFlash {
    /** Admin i18n key (or plain text) */
    success?: string;
    /** Admin i18n key (or plain text) */
    error?: string;
    approval?: ApprovalFlash;
    confirm_password?: true;
    session_expired?: true;
}

declare module '@inertiajs/core' {
    export interface InertiaConfig {
        sharedPageProps: {
            staff: SharedStaff | null;
            app: SharedApp;
            flash: SharedFlash;
            nav_counts: { approvals_for_me: number; alerts: number };
        };
    }
}
