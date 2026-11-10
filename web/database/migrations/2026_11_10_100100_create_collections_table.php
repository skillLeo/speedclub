<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Kollektionen" of DISC-01 (M2.3): a saved DISC-02 search with a title. `filters` holds the query parameters of search/vehicles
 * (slugs, as the app's URL carries them), `sort` one of SearchSort. The Phase 3 admin edits the table (ADM-29). A collection whose
 * filters match no visible build is left out of the page; the cover is the chosen build's when it is visible and matches, else the
 * cover of the collection's first build.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('collections', function (Blueprint $table) {
            $table->id();
            $table->string('key', 60)->unique();
            $table->json('title');
            $table->json('subtitle')->nullable();
            $table->foreignUlid('cover_vehicle_id')->nullable()->constrained('vehicles')->nullOnDelete();
            $table->json('filters');
            $table->string('sort', 20)->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->index(['active', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('collections');
    }
};
