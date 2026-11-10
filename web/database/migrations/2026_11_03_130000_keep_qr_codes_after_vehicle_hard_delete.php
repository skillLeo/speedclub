<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A code outlives the hard delete of its vehicle as a tombstone without a vehicle: the sticker on the car keeps reading "nicht mehr
     * verfügbar" instead of "kennen wir nicht", and the code can never be handed out again (App\Services\Qr\QrResolver).
     */
    public function up(): void
    {
        Schema::table('qr_codes', function (Blueprint $table) {
            $table->dropForeign(['vehicle_id']);
        });

        Schema::table('qr_codes', function (Blueprint $table) {
            $table->ulid('vehicle_id')->nullable()->change();
            $table->foreign('vehicle_id')->references('id')->on('vehicles')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('qr_codes', function (Blueprint $table) {
            $table->dropForeign(['vehicle_id']);
        });

        DB::table('qr_codes')->whereNull('vehicle_id')->delete();

        Schema::table('qr_codes', function (Blueprint $table) {
            $table->ulid('vehicle_id')->nullable(false)->change();
            $table->foreign('vehicle_id')->references('id')->on('vehicles')->cascadeOnDelete();
        });
    }
};
