<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M5.5 (m5.5-contract §8): `shop` reaches an existing host with the update, on outside production and off in production until the
     * client's Shopify store and real products exist (FeatureFlagSeeder::ON_OUTSIDE_PRODUCTION). An admin's row is never changed, and a
     * host without any flag yet is left to the seeder.
     */
    public function up(): void
    {
        if (! DB::table('feature_flags')->exists() || DB::table('feature_flags')->where('key', 'shop')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);

        DB::table('feature_flags')->insert([
            'key' => 'shop',
            'enabled' => ! app()->environment('production'),
            'rules' => null,
            'description' => is_array($descriptions) ? ($descriptions['shop'] ?? null) : null,
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
