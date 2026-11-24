<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M5.8 (m5.8-contract, ADR-506): `forum` reaches an existing host with the update, on in every environment
     * (FeatureFlagSeeder::ON_EVERYWHERE). An admin's row is never changed, and a host without any flag yet is left to the seeder.
     */
    public function up(): void
    {
        if (! DB::table('feature_flags')->exists() || DB::table('feature_flags')->where('key', 'forum')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);

        DB::table('feature_flags')->insert([
            'key' => 'forum',
            'enabled' => true,
            'rules' => null,
            'description' => is_array($descriptions) ? ($descriptions['forum'] ?? null) : null,
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
