<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M4.15 (09 §8.18): `web_push` is on outside production (FeatureFlagSeeder::ON_OUTSIDE_PRODUCTION) and off in production. On a host
     * without VAPID keys it changes nothing: app-config then has no public key and the member web hides the option. It reaches an
     * existing host with the update; an admin's row is never changed, and a host without any flag yet is left to the seeder.
     */
    public function up(): void
    {
        if (! DB::table('feature_flags')->exists() || DB::table('feature_flags')->where('key', 'web_push')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);

        DB::table('feature_flags')->insert([
            'key' => 'web_push',
            // As FeatureFlagSeeder::ON_OUTSIDE_PRODUCTION lists it.
            'enabled' => ! app()->environment('production'),
            'rules' => null,
            'description' => is_array($descriptions) ? ($descriptions['web_push'] ?? null) : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        app(AppConfig::class)->flush();
    }

    /**
     * Nothing to restore: removing a flag is an admin decision.
     */
    public function down(): void {}
};
