<?php

use App\Services\AppConfig\AppConfig;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M4.9 (09 §8.18): `sticker_shop` is off everywhere until the owner's shop exists (links.sticker_shop in the remote config). It reaches
     * an existing host with the update; an admin's row is never changed, and a host without any flag yet is left to the seeder.
     */
    public function up(): void
    {
        if (! DB::table('feature_flags')->exists() || DB::table('feature_flags')->where('key', 'sticker_shop')->exists()) {
            return;
        }

        $descriptions = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true);

        DB::table('feature_flags')->insert([
            'key' => 'sticker_shop',
            'enabled' => false,
            'rules' => null,
            'description' => is_array($descriptions) ? ($descriptions['sticker_shop'] ?? null) : null,
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
