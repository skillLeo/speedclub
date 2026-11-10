<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Für dich" pages on (rank_score, updated_at, vehicle_id) among public rows (M2.2). InnoDB appends the primary key vehicle_id to the
 * index, so a cursor page is a range on it, best score first and, among equal scores, the build changed last. The lone rank_score index of the data model stays.
 *
 * "Beliebte Mods diese Woche" reads the mods installed lately, through modifications(status, created_at).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vehicle_search', function (Blueprint $table) {
            $table->index(['is_public', 'rank_score', 'updated_at'], 'vehicle_search_is_public_rank_score_index');
        });

        Schema::table('modifications', function (Blueprint $table) {
            $table->index(['status', 'created_at'], 'modifications_status_created_at_index');
        });
    }

    public function down(): void
    {
        Schema::table('modifications', function (Blueprint $table) {
            $table->dropIndex('modifications_status_created_at_index');
        });

        Schema::table('vehicle_search', function (Blueprint $table) {
            $table->dropIndex('vehicle_search_is_public_rank_score_index');
        });
    }
};
