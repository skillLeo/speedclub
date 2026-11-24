<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.9a plate blur (10 §16.1, ADR-509, m5.9a-contract §2, §4):
     * - media.plate_blur: App\Enums\PlateBlurState. Existing photos are `unchecked` (the one-time "Kennzeichen prüfen" lists them), except
     *   those GAR-08 pixelated already or is about to (blurred_at or waiting blur_regions): `blurred`. Indexed with the owner for the
     *   plate check's list and count.
     * - users.plate_check_dismissed_at: "Später" on the garage card; the card never comes back once set.
     */
    public function up(): void
    {
        Schema::table('media', function (Blueprint $table): void {
            $table->string('plate_blur', 16)->default('unchecked')->after('blurred_at');
            $table->index(['owner_id', 'plate_blur'], 'media_owner_plate_blur_index');
        });

        DB::table('media')
            ->where(fn ($query) => $query->whereNotNull('blurred_at')->orWhereNotNull('blur_regions'))
            ->update(['plate_blur' => 'blurred']);

        Schema::table('users', function (Blueprint $table): void {
            $table->timestamp('plate_check_dismissed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('plate_check_dismissed_at');
        });

        Schema::table('media', function (Blueprint $table): void {
            $table->dropIndex('media_owner_plate_blur_index');
            $table->dropColumn('plate_blur');
        });
    }
};
