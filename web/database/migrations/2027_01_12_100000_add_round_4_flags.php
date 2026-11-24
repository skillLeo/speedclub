<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Client round 4 (11 R4-2.1, R4-2.2, R4-2.3; review SF-9): `crews` and `cotd_voting` reach an existing host with the update itself,
     * on outside production and off in production, as FeatureFlagSeeder decides. `build_comments` was off everywhere since M4.11; round
     * 4 switches comments on outside production, so an existing row that is still off is switched on there — production is never
     * touched (the client's OK first). Any other existing row (an admin's choice) is never changed, and a host without any flag yet is
     * left to the seeder.
     */
    private const NEW_FLAGS = ['crews', 'cotd_voting'];

    public function up(): void
    {
        // Only an existing, seeded host: a fresh install gets every flag from FeatureFlagSeeder, and an empty table (a new database,
        // the test database) stays empty so its baseline does not change.
        if (! DB::table('feature_flags')->exists()) {
            return;
        }

        $production = app()->environment('production');
        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);
        $existing = DB::table('feature_flags')->whereIn('key', self::NEW_FLAGS)->pluck('key')->all();

        foreach (self::NEW_FLAGS as $key) {
            if (in_array($key, $existing, true)) {
                continue;
            }

            DB::table('feature_flags')->insert([
                'key' => $key,
                'enabled' => ! $production,
                'rules' => null,
                'description' => is_array($descriptions) ? ($descriptions[$key] ?? null) : null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        if (! $production) {
            DB::table('feature_flags')->where('key', 'build_comments')->where('enabled', false)->update(['enabled' => true, 'updated_at' => now()]);
        }

        // app-config is cached per locale; clients would otherwise read the flags as missing until the cache expires.
        app(AppConfig::class)->flush();
    }

    /** Nothing to restore: removing a flag is an admin decision. */
    public function down(): void {}
};
