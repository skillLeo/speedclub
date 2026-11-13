/** Props of ADM-10, as App\Http\Controllers\Admin\Members\MemberShowController and App\Services\Admin\Members\MemberRecord send them. */
export interface MemberOverview {
    id: string;
    username: string | null;
    display_name: string | null;
    bio: string | null;
    city: string | null;
    email: string;
    email_masked: boolean;
    /** The viewer may reveal the address (members.view_pii, audited). The props never carry it unmasked (SEC-P3-02). */
    can_reveal_pii: boolean;
    email_verified_at: string | null;
    status: string;
    state: 'active' | 'restricted' | 'suspended' | 'deactivated' | 'pending_deletion';
    suspended: boolean;
    pending_deletion: boolean;
    deleted: boolean;
    avatar: string | null;
    restrictions: { type: 'messaging' | 'publishing' | 'suspension'; until: string | null; decision_id: string | null; decided_at: string | null }[];
    counters: { vehicles: number; followers: number; following: number; reports_as_target: number; decisions: number };
    consents: Consents;
    signup_ref: string | null;
    two_factor: boolean;
    created_at: string | null;
    last_seen_at: string | null;
}

export interface Consents {
    terms_version: string | null;
    privacy_version: string | null;
    consented_at: string | null;
    marketing_consent_at: string | null;
}

export interface MemberVehicle {
    id: string;
    title: string;
    nickname: string | null;
    model_year: number | null;
    status: string;
    visibility: string;
    hidden: boolean;
    cover: string | null;
    cover_focus?: string | null;
    cover_placeholder?: string | null;
    photos: number;
    mods: number;
    qr: string | null;
    updated_at: string | null;
}

export interface MemberSecurity {
    two_factor: { on: boolean; confirmed_at: string | null; locked_at: string | null };
    force_password_change: boolean;
    devices: { id: number; device_name: string | null; platform: string | null; app_version: string | null; view_as: boolean; created_at: string | null; last_used_at: string | null; expires_at: string | null }[];
    /** Matched to the member's tokens and browser sessions on the server (never a user agent, IP or fingerprint); all null when unknown. */
    sign_ins: {
        first_seen_at: string | null;
        last_seen_at: string | null;
        kind?: 'app' | 'browser' | null;
        name?: string | null;
        platform?: string | null;
        browser?: string | null;
        os?: string | null;
    }[];
    /** ADM-59 (M4.17): names and dates only, never a credential, provider subject, provider e-mail or IP. */
    passkeys?: { id: string; name: string; synced: boolean; created_at: string | null; last_used_at: string | null }[];
    providers?: { id: string; provider: 'apple' | 'google'; private_relay: boolean; linked_at: string | null; last_used_at: string | null }[];
    events?: { id: string; type: string; device_name: string | null; platform: string | null; approx_city: string | null; created_at: string }[];
}

export interface MemberReports {
    as_reporter: { id: string; case_id: string | null; case_status: string | null; target_type: string; target_label: string | null; reason: string; created_at: string | null }[];
    as_target: {
        case_id: string;
        origin: string;
        status: string;
        target_type: string;
        target_label: string | null;
        report_count: number;
        created_at: string | null;
        decision: { id: string; action: string; decided_at: string; reverses_decision_id: string | null } | null;
    }[];
}

export interface MessageMetadata {
    conversations: number;
    requests_sent_7_days: number;
    requests_sent_30_days: number;
    requests_accepted_30_days: number;
    accepted_rate_30_days: number | null;
    blocks_given: number;
    blocks_received: number;
}

export interface FeedEntry {
    id: number;
    occurred_at: string;
    action: string;
    actor: string | null;
    actor_type?: string;
    actor_id?: string | null;
    reason: string | null;
}

export interface MemberPrivacy {
    consents: Consents;
    exports: { id: string; status: string; for_staff: boolean; requested_by: string | null; requested_at: string | null; ready_at: string | null; expires_at: string | null; download: string | null }[];
    deletion: { requested_at: string | null; hard_delete_by: string | null };
}
