<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M4.12 (09 §8.18): `events` and `events.create` are on locally and on staging and off in production (client sign-off of the rules),
     * as FeatureFlagSeeder decides. They reach an existing host with the update itself. An existing row (an admin's choice) is never
     * changed, and a host without any flag yet is left to the seeder.
     */
    private const FLAGS = ['events', 'events.create'];

    public function up(): void
    {
        // Only an existing, seeded host: a fresh install gets every flag from FeatureFlagSeeder (DEPLOY 7), and an empty table (a new
        // database, the test database) stays empty so its baseline does not change.
        if (! DB::table('feature_flags')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);
        $existing = DB::table('feature_flags')->whereIn('key', self::FLAGS)->pluck('key')->all();

        foreach (self::FLAGS as $key) {
            if (in_array($key, $existing, true)) {
                continue;
            }

            DB::table('feature_flags')->insert([
                'key' => $key,
                'enabled' => ! app()->environment('production'),
                'rules' => null,
                'description' => is_array($descriptions) ? ($descriptions[$key] ?? null) : null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // app-config is cached per locale; clients would otherwise read the flags as missing until the cache expires.
        app(AppConfig::class)->flush();
    }

    /**
     * Nothing to restore: removing a flag is an admin decision.
     */
    public function down(): void {}
};
