<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Where the current Open Graph image lies, so hiding can remove it without knowing what it showed (App\Services\PublicPages\OgImages).
     */
    public function up(): void
    {
        Schema::table('vehicles', function (Blueprint $table) {
            $table->string('og_image_path', 120)->nullable()->after('cover_media_id');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('og_image_path', 120)->nullable()->after('cover_media_id');
        });
    }

    public function down(): void
    {
        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropColumn('og_image_path');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('og_image_path');
        });
    }
};
