<?php

use App\Services\Search\RebuildVehicleSearch;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * M2.3 DISC-02 filters and facets over every installed part, not just the first of a category. A build can carry two wheel sets, springs
 * of one brand and dampers of another, or a staggered set with a 19-inch front and a 20-inch rear (ADR-112): the single columns of
 * vehicle_search (wheel_diameter, wheel_brand_id, …) hold only the first of each, so a filter on them missed the rest. One row per build,
 * facet and value, written by VehicleSearchProjector in the same transaction as its vehicle_search row:
 *
 * - wheel_diameter: "19", "19.5" (front and rear of every installed wheel set);
 * - wheel_brand, suspension_brand, exhaust_brand: the catalogue brand id of an installed part, after merges;
 * - suspension_type: the option value ("coilover").
 *
 * Plain rows instead of JSON, so filters are an indexed EXISTS and facet counts a GROUP BY on every host (05_ARCHITECTURE §10). Existing
 * builds are queued for a rebuild, which the cron worker runs; `php artisan search:rebuild` does it at once.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicle_search_facets', function (Blueprint $table) {
            $table->foreignUlid('vehicle_id')->constrained('vehicle_search', 'vehicle_id')->cascadeOnDelete();
            $table->string('facet', 24)->charset('ascii')->collation('ascii_bin');
            $table->string('value', 64)->charset('ascii')->collation('ascii_bin');

            // Filters: an EXISTS per build on (vehicle_id, facet, value IN …). Counts: the rows of one facet whose build is in the filtered
            // set (facet, value; InnoDB appends vehicle_id).
            $table->primary(['vehicle_id', 'facet', 'value']);
            $table->index(['facet', 'value']);
        });

        DB::table('vehicle_search')->select('vehicle_id')->orderBy('vehicle_id')->chunk(500, function ($rows): void {
            foreach ($rows as $row) {
                RebuildVehicleSearch::dispatch((string) $row->vehicle_id);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_search_facets');
    }
};
