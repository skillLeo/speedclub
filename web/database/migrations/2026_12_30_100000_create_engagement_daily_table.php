<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADM-70 Insights overview (10 §11, m5.7-contract §9): platform counters per Europe/Berlin day for what the M5.7 tables do not keep —
 * a push the weekly engagement cap dropped (the claims table holds only the pushes that went out) and a plan prompt that was sent (its
 * notification row is removed once the mod is installed). One row per day and metric, no member, no vehicle, no notification id.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('engagement_daily', function (Blueprint $table) {
            $table->id();
            $table->date('day');
            $table->string('metric', 32);
            $table->unsignedInteger('count')->default(0);

            $table->unique(['day', 'metric']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('engagement_daily');
    }
};
