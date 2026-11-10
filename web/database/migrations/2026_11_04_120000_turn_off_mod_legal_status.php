<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * ADR-153: the legal status of mods stays off on every surface until M2.7 builds the field. FeatureFlagSeeder never touches an
     * existing row, so databases seeded before the ADR get the flag off here. An update by key, so running it again changes nothing.
     */
    public function up(): void
    {
        $changed = DB::table('feature_flags')
            ->where('key', 'sig.mod_legal_status')
            ->where('enabled', true)
            ->update(['enabled' => false, 'updated_at' => now()]);

        // app-config is cached per locale; clients would otherwise keep reading the flag as on until the cache expires.
        if ($changed > 0) {
            app(AppConfig::class)->flush();
        }
    }

    /**
     * Nothing to restore: the flag was on only because the seeder treated every sig.* alike, and turning it on again belongs to the
     * admin once M2.7 exists.
     */
    public function down(): void {}
};
