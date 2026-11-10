<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Personal saved views of the admin tables (06_ADMIN_SPEC §5, contract §2.3). Presets are defined in the page code; only a staff
 * member's own views are stored. A view is a filter/sort/page-size query, never data.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('admin_saved_views', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnDelete();
            $table->string('table_key', 60);
            $table->string('name', 80);
            $table->json('query');
            $table->timestamps();

            $table->unique(['staff_id', 'table_key', 'name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_saved_views');
    }
};
