<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M4.2 (09 §8.19, §4.6). users.is_editorial marks the one SPEED CLUB Editorial account that owns the sample builds (badge "Editorial");
 * it is a sample account too (is_sample), so the purge and the editorial_samples flag treat it like every other sample row. Indexed, as
 * the admin and the badge filter on it. media.thumbhash holds the ThumbHash of a seed photo, computed by design/scripts/process-photos.mjs
 * and copied in by the seeders; member uploads keep their blurhash and leave it null. Plain columns and indexes: MySQL 8 and MariaDB 10.6+.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_editorial')->default(false)->index();
        });

        Schema::table('media', function (Blueprint $table) {
            $table->string('thumbhash', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('media', function (Blueprint $table) {
            $table->dropColumn('thumbhash');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['is_editorial']);
            $table->dropColumn('is_editorial');
        });
    }
};
