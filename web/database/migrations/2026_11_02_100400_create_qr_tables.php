<?php

use App\Enums\QrStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('qr_codes', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->char('code', 8)->unique();
            $table->string('status', 20)->default(QrStatus::Active->value)->index();
            $table->timestamp('revoked_at')->nullable();
            $table->string('revoked_reason', 30)->nullable();
            $table->timestamps();

            $table->index(['vehicle_id', 'status']);
        });

        Schema::create('qr_scan_daily', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('qr_code_id')->constrained()->cascadeOnDelete();
            $table->date('day')->index();
            $table->unsignedInteger('count')->default(0);

            $table->unique(['qr_code_id', 'day']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('qr_scan_daily');
        Schema::dropIfExists('qr_codes');
    }
};
