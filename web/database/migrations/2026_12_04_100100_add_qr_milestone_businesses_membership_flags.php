<?php

use App\Services\AppConfig\AppConfig;
use Database\Seeders\FeatureFlagSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Phase 4 lane B (09 §8.18): `qr_milestone` (on outside production, FeatureFlagSeeder::ON_OUTSIDE_PRODUCTION), `businesses` and
     * `membership` (off everywhere) reach an existing host with the update. An existing row (an admin's choice) is never changed, and a
     * host without any flag yet is left to the seeder.
     */
    public function up(): void
    {
        if (! DB::table('feature_flags')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);
        $production = app()->environment('production');
        $inserted = false;

        foreach (['qr_milestone', 'businesses', 'membership'] as $key) {
            if (DB::table('feature_flags')->where('key', $key)->exists()) {
                continue;
            }

            DB::table('feature_flags')->insert([
                'key' => $key,
                'enabled' => ! $production && array_key_exists($key, FeatureFlagSeeder::ON_OUTSIDE_PRODUCTION),
                'rules' => null,
                'description' => is_array($descriptions) ? ($descriptions[$key] ?? null) : null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $inserted = true;
        }

        // app-config is cached per locale; clients would otherwise read the flags as missing until the cache expires.
        if ($inserted) {
            app(AppConfig::class)->flush();
        }
    }

    /**
     * Nothing to restore: removing a flag is an admin decision.
     */
    public function down(): void {}
};
