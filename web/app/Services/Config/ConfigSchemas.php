<?php

namespace App\Services\Config;

use App\Enums\ConfigKey;
use App\Services\Config\Schemas\AnnouncementsSchema;
use App\Services\Config\Schemas\BrandingSchema;
use App\Services\Config\Schemas\HomeCurationSchema;
use App\Services\Config\Schemas\OrgSchema;
use App\Services\Config\Schemas\RateLimitsSchema;
use App\Services\Config\Schemas\RemoteConfigSchema;
use App\Services\Config\Schemas\RetentionSchema;

final class ConfigSchemas
{
    public function for(ConfigKey $key): ConfigSchema
    {
        return app(match ($key) {
            ConfigKey::Branding => BrandingSchema::class,
            ConfigKey::HomeCuration => HomeCurationSchema::class,
            ConfigKey::Announcements => AnnouncementsSchema::class,
            ConfigKey::RemoteConfig => RemoteConfigSchema::class,
            ConfigKey::RateLimits => RateLimitsSchema::class,
            ConfigKey::Org => OrgSchema::class,
            ConfigKey::Retention => RetentionSchema::class,
        });
    }
}
