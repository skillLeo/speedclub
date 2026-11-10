<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M2.7 builds the legal status of mods (field, editor, WEB-01 pills with the disclaimer), so ADR-153 lifts: like every sig.* flag it is
     * on outside production. FeatureFlagSeeder never touches an existing row, and the data update of 2026_11_04 switched it off, so
     * non-production databases get it on here. Production keeps whatever the admin set. An update by key: running it again changes nothing.
     */
    public function up(): void
    {
        if (app()->environment('production')) {
            return;
        }

        $changed = DB::table('feature_flags')
            ->where('key', 'sig.mod_legal_status')
            ->where('enabled', false)
            ->update(['enabled' => true, 'updated_at' => now()]);

        // app-config is cached per locale; clients would otherwise keep reading the flag as off until the cache expires.
        if ($changed > 0) {
            app(AppConfig::class)->flush();
        }
    }

    /**
     * Nothing to restore: off again is an admin decision.
     */
    public function down(): void {}
};
