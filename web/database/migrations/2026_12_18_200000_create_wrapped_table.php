<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.9e Season Wrapped (10 §16.5, m5.9e contract §1): one payload per member and season (`2027-saison`, `2027-jahr`), written by
     * GenerateWrapped (idempotent upsert on the unique pair), read by GET me/wrapped/{season_key}. Only the member's own data; the
     * payload holds references (vehicle and media ids, city names, keys), the API resolves URLs and words per request.
     */
    public function up(): void
    {
        Schema::create('wrapped', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('season_key', 12);
            $table->json('payload');
            // The member was a sample account when it was generated: shown outside production only, never generated in production.
            $table->boolean('is_sample')->default(false)->index();
            $table->timestamp('generated_at');
            $table->timestamp('viewed_at')->nullable();
            $table->unsignedInteger('shared_count')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'season_key']);
            $table->index(['season_key', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wrapped');
    }
};
