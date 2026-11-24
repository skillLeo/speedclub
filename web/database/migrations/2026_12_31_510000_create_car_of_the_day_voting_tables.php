<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Client round 4 (R4-2.1, contract-cotd-voting §1), flag cotd_voting: the frozen candidates of a day's round (the Picker's top 3 when it
 * opens at 18:00 the day before), one vote per account and round, and whether a day's pick came from the votes. Additive only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('car_of_the_day_candidates', function (Blueprint $table): void {
            $table->id();
            $table->date('day');
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('position');
            $table->timestamp('created_at')->nullable();
            $table->unique(['day', 'vehicle_id'], 'cotd_candidates_day_vehicle_unique');
            $table->unique(['day', 'position'], 'cotd_candidates_day_position_unique');
        });

        Schema::create('car_of_the_day_votes', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->date('day');
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['day', 'user_id'], 'cotd_votes_day_user_unique');
            $table->index(['day', 'vehicle_id'], 'cotd_votes_day_vehicle_index');
        });

        Schema::table('car_of_the_day', function (Blueprint $table): void {
            $table->boolean('by_vote')->default(false)->after('source');
        });
    }

    public function down(): void
    {
        Schema::table('car_of_the_day', function (Blueprint $table): void {
            $table->dropColumn('by_vote');
        });
        Schema::dropIfExists('car_of_the_day_votes');
        Schema::dropIfExists('car_of_the_day_candidates');
    }
};
