<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M5.6 (m5.6-contract §3): `events.gallery` and `events.checkin` reach an existing, seeded host with the update, **off** in every
     * environment (staff switch them on for QA on staging in ADM flags). An admin's row is never changed, and a host without any flag
     * yet is left to FeatureFlagSeeder.
     */
    private const FLAGS = ['events.gallery', 'events.checkin'];

    public function up(): void
    {
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
                'enabled' => false,
                'rules' => null,
                'description' => is_array($descriptions) ? ($descriptions[$key] ?? null) : null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        app(AppConfig::class)->flush();
    }

    /**
     * Nothing to restore: removing a flag is an admin decision.
     */
    public function down(): void {}
};
