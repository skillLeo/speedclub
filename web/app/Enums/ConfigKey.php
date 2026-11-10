<?php

namespace App\Enums;

/**
 * The runtime config keys of the one versioning model (m3.5 contract §1): each is a config_versions series with at most one draft,
 * published with a reason, rolled back by publishing a copy. Atoms per 06_ADMIN_SPEC §2/§3: branding with `brand.manage`; Home curation
 * and announcements drafted with `content.edit`, published with `content.publish`; remote config with `remote_config.manage` (maintenance
 * on is four-eyes, `maintenance.toggle`); rate-limit overrides (M3.4, ADM-23) with `moderation.rules`; the org's legal identity (M3.6)
 * only by an Owner (06 §2: Admin is everything except it).
 */
enum ConfigKey: string
{
    case Branding = 'branding';
    case HomeCuration = 'home_curation';
    case Announcements = 'announcements';
    case RemoteConfig = 'remote_config';
    case RateLimits = 'rate_limits';
    case Org = 'org';
    /** M3.6 ADM-47: the editable retention periods of 06 §4, read by the prune commands (RetentionPolicy). */
    case Retention = 'retention';

    public function editAtom(): string
    {
        return match ($this) {
            self::Branding => 'brand.manage',
            self::HomeCuration, self::Announcements => 'content.edit',
            self::RemoteConfig => 'remote_config.manage',
            self::RateLimits => 'moderation.rules',
            self::Org => 'staff.manage',
            self::Retention => 'retention.manage',
        };
    }

    public function publishAtom(): string
    {
        return match ($this) {
            self::HomeCuration, self::Announcements => 'content.publish',
            default => $this->editAtom(),
        };
    }

    /** Only an Owner drafts, publishes or rolls back this key. */
    public function ownerOnly(): bool
    {
        return $this === self::Org;
    }

    /** Whether the published payload reaches GET app-config (so a publish flushes it and a preview token may overlay it). */
    public function inAppConfig(): bool
    {
        return in_array($this, [self::Branding, self::HomeCuration, self::Announcements, self::RemoteConfig], true);
    }
}
