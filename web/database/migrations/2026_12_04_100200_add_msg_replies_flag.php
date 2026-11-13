<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * ADR-445, ADR-450: `msg_replies` (SM11 swipe-to-reply and the quote) reaches an existing host off, now that the API stores
     * reply_to_id and returns reply_to; turning it on is an admin decision. An existing row is never changed, and a host without any flag
     * yet is left to the seeder.
     */
    public function up(): void
    {
        if (! DB::table('feature_flags')->exists() || DB::table('feature_flags')->where('key', 'msg_replies')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);

        DB::table('feature_flags')->insert([
            'key' => 'msg_replies',
            'enabled' => false,
            'rules' => null,
            'description' => is_array($descriptions) ? ($descriptions['msg_replies'] ?? null) : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // app-config is cached per locale; clients would otherwise read the flag as missing until the cache expires.
        app(AppConfig::class)->flush();
    }

    /**
     * Nothing to restore: removing a flag is an admin decision.
     */
    public function down(): void {}
};
