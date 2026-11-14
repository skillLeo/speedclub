<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M4.18: speedclub:prune-platform now removes the daily business profile views older than views_retention_days (hourly), a filter on
 * `day` across all businesses that the unique (business_id, day) key cannot serve.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('business_view_days', function (Blueprint $table): void {
            $table->index('day');
        });
    }

    public function down(): void
    {
        Schema::table('business_view_days', function (Blueprint $table): void {
            $table->dropIndex(['day']);
        });
    }
};
