<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.9b STREET DEX (10 §16.2, docs/reports/phase-5/m5.9b-contract.md §0–§1, ADR-508).
     *
     * Privacy (contract §0, hard): no latitude/longitude, geohash, point or any other coordinate column in any of these tables or in
     * vehicles. A spot knows a city id and a Bundesland only; the city centroids live in the public static file
     * public/geo/de-cities.json and are never joined to a spot (SpotPrivacySchemaTest).
     *
     * - sequence_counters: named counters taken under a row lock (dex numbers now; founding numbers in M5.9d). Each database numbers on
     *   its own, so production and staging never share a sequence.
     * - vehicles: dex_number (assigned at the first publish, existing published vehicles backfilled by published_at), the owner's
     *   switches ghost_mode / spotting_paused / hide_spot_cities, the rarity tier and when it was computed.
     * - users: show_my_spots ("Meine Spots zeigen", default on), bundesland (from the SET-11 region or the profile city).
     * - de_cities: GeoNames cities1000 of Germany (CC BY 4.0, database/data/CREDITS.md), seeded by DeCitySeeder; the id is the
     *   GeoNames id, the same as in the static file.
     * - spots, vehicle_spot_stats, dex_sets, user_set_progress, spot_alerts.
     */
    public function up(): void
    {
        Schema::create('sequence_counters', function (Blueprint $table): void {
            $table->string('key', 40)->primary();
            $table->unsignedBigInteger('value')->default(0);
        });

        Schema::table('vehicles', function (Blueprint $table): void {
            $table->unsignedInteger('dex_number')->nullable()->unique();
            $table->boolean('ghost_mode')->default(false);
            $table->boolean('spotting_paused')->default(false);
            $table->boolean('hide_spot_cities')->default(false);
            $table->string('rarity', 16)->nullable();
            $table->timestamp('rarity_computed_at')->nullable();
            $table->index('ghost_mode', 'vehicles_ghost_mode_index');
            $table->index('rarity', 'vehicles_rarity_index');
        });

        Schema::table('users', function (Blueprint $table): void {
            $table->boolean('show_my_spots')->default(true);
            $table->char('bundesland', 2)->nullable();
            $table->index('bundesland', 'users_bundesland_index');
        });

        Schema::create('de_cities', function (Blueprint $table): void {
            // The GeoNames id, as in public/geo/de-cities.json: never auto-incremented.
            $table->unsignedInteger('id')->primary();
            $table->string('name', 120);
            $table->string('ascii_name', 120);
            $table->string('slug', 140);
            $table->char('bundesland', 2);
            $table->unsignedInteger('population')->default(0);
            $table->index(['slug', 'population'], 'de_cities_slug_population_index');
            $table->index('ascii_name', 'de_cities_ascii_name_index');
            $table->index('bundesland', 'de_cities_bundesland_index');
        });

        Schema::create('spots', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('vehicle_id')->constrained('vehicles')->cascadeOnDelete();
            $table->foreignUlid('spotter_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedInteger('city_id')->nullable();
            $table->char('bundesland', 2)->nullable();
            $table->boolean('is_first_three')->default(false);
            $table->boolean('counted')->default(true);
            $table->boolean('is_night')->default(false);
            $table->string('source', 16)->default('scanner');
            $table->timestamp('created_at')->nullable();
            // Staff removal with a reason (contract §1, ADM "Spots" in part 2): soft delete, the reason and actor go to the audit log.
            $table->softDeletes();
            $table->foreign('city_id')->references('id')->on('de_cities')->nullOnDelete();
            $table->index(['vehicle_id', 'spotter_id', 'created_at'], 'spots_vehicle_spotter_created_index');
            $table->index(['spotter_id', 'created_at'], 'spots_spotter_created_index');
            $table->index(['city_id', 'created_at'], 'spots_city_created_index');
        });

        Schema::create('vehicle_spot_stats', function (Blueprint $table): void {
            $table->foreignUlid('vehicle_id')->primary()->constrained('vehicles')->cascadeOnDelete();
            $table->unsignedInteger('total')->default(0);
            $table->unsignedInteger('unique_spotters')->default(0);
            // Day spots only (contract §0): a night spot never names its city for a single car.
            $table->unsignedInteger('cities_count')->default(0);
            $table->timestamp('last_spot_at')->nullable();
            // "Street Famous" at 10 / 50 / 100 / 500 unique spotters (contract §4); the badge itself is M5.9d's.
            $table->unsignedSmallInteger('street_famous_tier')->nullable();
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('dex_sets', function (Blueprint $table): void {
            $table->string('key', 60)->primary();
            $table->string('name_de', 80);
            $table->string('name_en', 80);
            $table->string('kind', 16);
            $table->json('rule_json');
            // Season window as month-day ("03-01"), null for sets without one.
            $table->char('starts_on', 5)->nullable();
            $table->char('ends_on', 5)->nullable();
            $table->boolean('hidden')->default(false);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
            $table->index(['hidden', 'sort'], 'dex_sets_hidden_sort_index');
        });

        Schema::create('user_set_progress', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('set_key', 60);
            // The year of a season set ("2027"); empty for sets without a window, so the unique key holds for both.
            $table->string('period', 10)->default('');
            $table->unsignedInteger('progress')->default(0);
            $table->unsignedInteger('target')->default(0);
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->foreign('set_key')->references('key')->on('dex_sets')->cascadeOnDelete();
            $table->unique(['user_id', 'set_key', 'period'], 'user_set_progress_unique');
            $table->index('set_key', 'user_set_progress_set_key_index');
        });

        Schema::create('spot_alerts', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('vehicle_id')->constrained('vehicles')->cascadeOnDelete();
            $table->timestamp('window_start')->nullable();
            $table->unsignedInteger('count')->default(0);
            $table->json('city_ids')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->index(['vehicle_id', 'sent_at'], 'spot_alerts_vehicle_sent_index');
        });

        $this->backfillDexNumbers();
    }

    /**
     * Existing published vehicles get their numbers in the order they were first published (contract §1). The counter keeps the last.
     */
    private function backfillDexNumbers(): void
    {
        $next = 0;

        DB::table('vehicles')
            ->whereNotNull('published_at')
            ->whereNull('deleted_at')
            ->whereNull('dex_number')
            ->orderBy('published_at')
            ->orderBy('id')
            ->select('id')
            ->chunk(500, function ($rows) use (&$next): void {
                foreach ($rows as $row) {
                    DB::table('vehicles')->where('id', $row->id)->update(['dex_number' => ++$next]);
                }
            });

        DB::table('sequence_counters')->insert(['key' => 'dex_number', 'value' => $next]);
    }

    public function down(): void
    {
        Schema::dropIfExists('spot_alerts');
        Schema::dropIfExists('user_set_progress');
        Schema::dropIfExists('dex_sets');
        Schema::dropIfExists('vehicle_spot_stats');
        Schema::dropIfExists('spots');
        Schema::dropIfExists('de_cities');

        Schema::table('users', function (Blueprint $table): void {
            $table->dropIndex('users_bundesland_index');
            $table->dropColumn(['show_my_spots', 'bundesland']);
        });

        Schema::table('vehicles', function (Blueprint $table): void {
            $table->dropIndex('vehicles_ghost_mode_index');
            $table->dropIndex('vehicles_rarity_index');
            $table->dropUnique(['dex_number']);
            $table->dropColumn(['dex_number', 'ghost_mode', 'spotting_paused', 'hide_spot_cities', 'rarity', 'rarity_computed_at']);
        });

        Schema::dropIfExists('sequence_counters');
    }
};
