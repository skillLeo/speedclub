<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M5.9 (m5.9-contract §4): `ai.vehicle_specs`, `ai.product_match` and `ai.forum_summary` reach an existing host **off**, like every
     * ai.* flag (ADR-031): staff switch them on in ADM-35 once an AI provider key exists (UpdateFeatureFlag refuses it before). An admin's
     * row is never changed; a host without any flag yet is left to the seeder.
     */
    private const KEYS = ['ai.vehicle_specs', 'ai.product_match', 'ai.forum_summary'];

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
