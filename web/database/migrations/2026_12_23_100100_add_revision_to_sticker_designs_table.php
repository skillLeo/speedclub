<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Review MF-4 (m5.4-contract §3.1): a draft is updated in place at the same version, so the version alone cannot tell two devices
     * apart. `revision` moves on every write of the design's content (autosave, restore, a new version) and the PUT and the restore
     * answer 409 edit_conflict when the app's `base_revision` is not the stored one. Existing rows start at 0.
     */
    public function up(): void
    {
        Schema::table('sticker_designs', function (Blueprint $table) {
            $table->unsignedInteger('revision')->default(0)->after('version');
        });
    }

    public function down(): void
    {
        Schema::table('sticker_designs', function (Blueprint $table) {
            $table->dropColumn('revision');
        });
    }
};
