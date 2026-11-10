<?php

namespace Database\Seeders;

use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use App\Services\Brand\AccentSets;
use Illuminate\Database\Seeder;

/**
 * The first published version of each app-config section (App\Services\AppConfig\AppConfig holds the payload shape).
 * A section that already has a version is left alone: later versions belong to the publish flow.
 */
class ConfigSeeder extends Seeder
{
    /** The first release: mobile/version.json. */
    private const FIRST_VERSION = '0.1.0';

    public function run(): void
    {
        $sections = [
            'remote_config' => [
                'min_version' => ['ios' => self::FIRST_VERSION, 'android' => self::FIRST_VERSION],
                'latest_version' => ['ios' => self::FIRST_VERSION, 'android' => self::FIRST_VERSION],
                'maintenance' => ['enabled' => false, 'message' => null],
            ],
            'branding' => [
                'logo' => '/brand/logo-wide-white-640.webp',
                'splash_image' => '/brand/logo-wide-on-texture.webp',
                // Null keeps the night photo bundled with the app (FS-1); this slot is for an admin override.
                'welcome_hero' => null,
                // The real set key, not the alias `default`: ADM-35 compares versions by value (DQ-668).
                'accent_set' => app(AccentSets::class)->defaultKey(),
                'default_theme' => 'carbon',
            ],
        ];

        foreach ($sections as $key => $payload) {
            if (ConfigVersion::query()->where('key', $key)->exists()) {
                continue;
            }

            ConfigVersion::query()->create([
                'key' => $key,
                'version' => 1,
                'status' => ConfigVersionStatus::Published,
                'payload' => $payload,
                'published_at' => now(),
                'reason' => 'Erstinstallation',
            ]);
        }
    }
}
