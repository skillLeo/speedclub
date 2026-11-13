<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M4.14 (09 §8.18): `parts_catalogue` and `affiliate_links` reach an existing host with the update, off in every environment
     * (`businesses` came with 2026_12_04_100100, also off): the lead turns parts and businesses on once the module passed its review
     * (09: on · on · off). An existing row (an admin's choice) is never changed, and a host without any flag yet is left to the seeder.
     */
    private const FLAGS = ['parts_catalogue', 'affiliate_links'];

    public function up(): void
    {
        if (! DB::table('feature_flags')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);
        $inserted = false;

        foreach (self::FLAGS as $key) {
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
            $inserted = true;
        }

        if ($inserted) {
            app(AppConfig::class)->flush();
        }
    }

    /**
     * Nothing to restore: removing a flag is an admin decision.
     */
    public function down(): void {}
};
