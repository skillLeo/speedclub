<?php

use App\Services\Search\RebuildVehicleSearch;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * M1.8 text search (App\Services\Search\SearchTerms). The FULLTEXT index of search_text cannot find "m4" or "r34": InnoDB skips
 * words below innodb_ft_min_token_size (3) and ngram is not available on every host. These columns hold the same text normalised
 * to space-separated lowercase ASCII words, so a prefix match is a portable LIKE. title_keys are make, model, generation, nickname
 * and engine code, which weigh more in the relevance.
 *
 * The keys are ASCII by construction, so they are stored as ascii_bin: LIKE then compares bytes instead of applying the Unicode
 * collation to every character, which made the unanchored LIKE several times slower (SEC-M18-01).
 *
 * Existing rows: updated_at is filled where a row predates the projector writing it, so "Neue Builds" can order on the column
 * and its index (is_public, updated_at); and every existing row is queued for a rebuild, as the keys need PHP (SearchTerms). The
 * cron worker runs those jobs after the deploy; until then the rows are found by nothing, which `php artisan speedclub:doctor`
 * reports, and `php artisan search:rebuild` does the same at once.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vehicle_search', function (Blueprint $table) {
            $table->string('title_keys', 1000)->charset('ascii')->collation('ascii_bin')->nullable()->after('search_text');
            $table->text('search_keys')->charset('ascii')->collation('ascii_bin')->nullable()->after('title_keys');
            // Neue Builds: public rows, newest first. InnoDB appends the key vehicle_id, the tie-break of the order.
            $table->index(['is_public', 'updated_at']);
        });

        DB::table('vehicle_search', 'vs')
            ->join('vehicles as v', 'v.id', '=', 'vs.vehicle_id')
            ->whereNull('vs.updated_at')
            ->update(['vs.updated_at' => DB::raw('COALESCE(v.updated_at, v.published_at, v.created_at)')]);

        DB::table('vehicle_search')->select('vehicle_id')->orderBy('vehicle_id')->chunk(500, function ($rows): void {
            foreach ($rows as $row) {
                RebuildVehicleSearch::dispatch((string) $row->vehicle_id);
            }
        });
    }

    public function down(): void
    {
        Schema::table('vehicle_search', function (Blueprint $table) {
            $table->dropIndex(['is_public', 'updated_at']);
            $table->dropColumn(['title_keys', 'search_keys']);
        });
    }
};
