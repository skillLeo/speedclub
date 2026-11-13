<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M4.5 (09 §8.18): the kill switch nav.native_tabs reaches an existing host with the update itself, on everywhere as
     * FeatureFlagSeeder decides (the app also treats a missing key as on). An existing row (an admin's choice) is never changed, and a host
     * without any flag yet is left to the seeder.
     */
    public function up(): void
    {
        // Only an existing, seeded host: a fresh install gets every flag from FeatureFlagSeeder (DEPLOY 7), and an empty table (a new
        // database, the test database) stays empty so its baseline does not change.
        if (! DB::table('feature_flags')->exists() || DB::table('feature_flags')->where('key', 'nav.native_tabs')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);

        DB::table('feature_flags')->insert([
            'key' => 'nav.native_tabs',
            'enabled' => true,
            'rules' => null,
            'description' => is_array($descriptions) ? ($descriptions['nav.native_tabs'] ?? null) : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // app-config is cached per locale; clients would otherwise read the flag as missing until the cache expires.
        app(AppConfig::class)->flush();
    }

    /**
     * Nothing to restore: removing the flag is an admin decision.
     */
    public function down(): void {}
};
