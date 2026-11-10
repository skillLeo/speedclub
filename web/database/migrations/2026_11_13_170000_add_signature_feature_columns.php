<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M2.7 signature features (02_PRODUCT_SPEC §5, §7):
 *
 * - vehicles.qr_milestone: the highest scan milestone (10, 50, 100, 500, 1000) the owner was told about, so qr:milestones tells each one
 *   once, also after the notification itself was pruned. 0 = none yet.
 * - vehicles.hu_au_reminded_for: the due month (first day) the HU/AU reminder went out for, so it goes once per due date; a new due date
 *   gets its own.
 * - media.blur_regions: the regions waiting for the queued pixelation (sig.plate_blur), normalised 0–1; null when none waits.
 * - media.blurred_at: when regions were last pixelated into every file of the photo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vehicles', function (Blueprint $table) {
            $table->unsignedSmallInteger('qr_milestone')->default(0)->after('hu_au_due');
            $table->date('hu_au_reminded_for')->nullable()->after('qr_milestone');
        });

        Schema::table('media', function (Blueprint $table) {
            $table->json('blur_regions')->nullable()->after('blurhash');
            $table->timestamp('blurred_at')->nullable()->after('blur_regions');
        });
    }

    public function down(): void
    {
        Schema::table('media', function (Blueprint $table) {
            $table->dropColumn(['blur_regions', 'blurred_at']);
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropColumn(['qr_milestone', 'hu_au_reminded_for']);
        });
    }
};
