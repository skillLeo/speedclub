<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.4 Sticker designer (10 §2.3, m5.4-contract §1): one row per version of a vehicle's sticker design. The highest version is the
     * current one; a validated version is frozen and the next edit opens version n + 1. Nothing about who scans or views a sticker.
     */
    public function up(): void
    {
        Schema::create('sticker_designs', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('version');
            // "SD" + 8 Crockford characters: the design id of the slug area, Shopify and the print partner.
            $table->char('reference', 10)->unique();
            $table->string('template', 20)->index();
            $table->json('options');
            // The code a validated version was tested with; its print files always draw this code.
            $table->foreignUlid('qr_code_id')->nullable()->index()->constrained('qr_codes')->nullOnDelete();
            $table->timestamp('validated_at')->nullable()->index();
            $table->string('scan_test', 20)->nullable();
            $table->string('client_scan_test', 20)->nullable();
            $table->timestamp('order_requested_at')->nullable()->index();
            $table->timestamps();

            $table->unique(['vehicle_id', 'version']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sticker_designs');
    }
};
