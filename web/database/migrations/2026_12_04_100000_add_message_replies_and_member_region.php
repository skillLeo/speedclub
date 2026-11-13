<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Phase 4 API follow-ups (lane B, M4.10/M4.12 gaps):
     *
     * - messages.reply_to_id: SM11 swipe-to-reply (ADR-445). A message of the same conversation; a hard-deleted original leaves the
     *   reply without its quote.
     * - users.locale_follows_system: SET-11 "Sprache: System". `locale` stays the language mails and pushes use (de/en); with the
     *   switch on, the app follows the device and every PATCH of the locale "system" refreshes `locale` from the device language.
     * - users.home_region_*: SET-11 "Region für in deiner Nähe" (09 §8.7): a city the member chose, its point snapped to the 0.05°
     *   grid of event areas. Never public, never the device location.
     */
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->foreignUlid('reply_to_id')->nullable()->after('vehicle_id')->constrained('messages')->nullOnDelete();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->boolean('locale_follows_system')->default(false)->after('locale');
            $table->string('home_region_label', 80)->nullable()->after('city');
            $table->decimal('home_region_lat', 8, 5)->nullable()->after('home_region_label');
            $table->decimal('home_region_lng', 8, 5)->nullable()->after('home_region_lat');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropConstrainedForeignId('reply_to_id');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['locale_follows_system', 'home_region_label', 'home_region_lat', 'home_region_lng']);
        });
    }
};
