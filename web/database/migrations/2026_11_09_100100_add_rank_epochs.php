<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Für dich scores, double-buffered (M2.2 review #8). An even epoch reads rank_score, an odd one rank_score_alt. php artisan home:rank
 * writes the column the next epoch reads and then switches, so a page of a cursor reads the scores its first page read. The column of
 * the epoch before stays intact until the next run starts writing into it; older cursors are refused and the app starts from the top.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vehicle_search', function (Blueprint $table) {
            $table->double('rank_score_alt')->default(0)->after('rank_score');
            $table->index(['is_public', 'rank_score_alt', 'updated_at'], 'vehicle_search_is_public_rank_score_alt_index');
        });

        DB::table('vehicle_search')->update(['rank_score_alt' => DB::raw('rank_score')]);

        Schema::create('home_rank_state', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedInteger('epoch')->default(0);
            $table->boolean('writing')->default(false);
            $table->timestamp('ranked_at')->nullable();
        });

        DB::table('home_rank_state')->insert(['id' => 1, 'epoch' => 0, 'writing' => false]);
    }

    public function down(): void
    {
        Schema::dropIfExists('home_rank_state');

        Schema::table('vehicle_search', function (Blueprint $table) {
            $table->dropIndex('vehicle_search_is_public_rank_score_alt_index');
            $table->dropColumn('rank_score_alt');
        });
    }
};
