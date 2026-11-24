<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M5.7 (m5.7-contract §1.8): `insights`, `build_prompts` and `weekly_recap` reach an existing host with the update, on in every
     * environment (FeatureFlagSeeder::ON_EVERYWHERE); they are kill switches for staff, members have their own switches. An admin's row
     * is never changed, and a host without any flag yet is left to the seeder.
     */
    private const KEYS = ['insights', 'build_prompts', 'weekly_recap'];

    public function up(): void
    {
        if (! DB::table('feature_flags')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);

        foreach (self::KEYS as $key) {
            if (DB::table('feature_flags')->where('key', $key)->exists()) {
                continue;
            }

            DB::table('feature_flags')->insert([
                'key' => $key,
                'enabled' => true,
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
