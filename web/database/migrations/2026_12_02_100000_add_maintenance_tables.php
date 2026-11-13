<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M4.13 Garage pro (09 §8.8, §8.11, §11): maintenance items and the service log per vehicle (private to the owner, costs included), the
 * reminders that went out (the dedupe store of the server + local reminder contract), the vehicle's last known mileage, and the member's
 * SET-11 units and SET-23 reminder defaults. Plain columns and an index for every foreign key and filter: MySQL 8 and MariaDB 10.6+.
 * Reversible.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('maintenance_items', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20);
            // The type for every type that exists once per vehicle, null for custom items: unique with the vehicle (NULLs never collide).
            $table->string('slot', 20)->nullable();
            $table->string('title', 80)->nullable();
            $table->unsignedSmallInteger('interval_months')->nullable();
            $table->unsignedInteger('interval_km')->nullable();
            $table->date('last_done_at')->nullable();
            $table->unsignedInteger('last_done_km')->nullable();
            $table->date('next_due_at')->nullable();
            $table->unsignedInteger('next_due_km')->nullable();
            // The member's own due date (from the service booklet, the plakette) instead of last time + interval.
            $table->boolean('due_pinned')->default(false);
            $table->json('lead_days')->nullable();
            $table->boolean('enabled')->default(true);
            $table->string('notes', 500)->nullable();
            // Optimistic concurrency for the offline outbox (09 §8.12): a PATCH naming an older version answers 409 edit_conflict.
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['vehicle_id', 'slot']);
            $table->index(['enabled', 'next_due_at']);
            $table->index(['enabled', 'next_due_km']);
        });

        Schema::create('maintenance_logs', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('item_id')->nullable()->constrained('maintenance_items')->nullOnDelete();
            $table->string('type', 20);
            $table->string('title', 80)->nullable();
            $table->date('done_at');
            $table->unsignedInteger('mileage_km')->nullable();
            // M4.14 business profiles ("Werkstatt"): no foreign key until that table exists; the free text stays possible.
            $table->char('business_id', 26)->nullable()->index();
            $table->string('workshop', 120)->nullable();
            // Private to the owner, always (09 §11): never in another member's answer, a public page or an export of somebody else.
            $table->unsignedInteger('cost_cents')->nullable();
            $table->char('currency', 3)->default('EUR');
            $table->string('notes', 1000)->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->index(['vehicle_id', 'done_at']);
        });

        Schema::create('maintenance_reminders', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('item_id')->constrained('maintenance_items')->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            // "mnt:{item}:d2027-03-01:30" / "mnt:{item}:k120000": the deterministic id the app also gives its local backup notification.
            $table->string('reminder_key', 120)->unique();
            $table->date('due_on')->nullable();
            $table->unsignedInteger('due_km')->nullable();
            $table->unsignedSmallInteger('lead_days')->nullable();
            // Null for a stage passed over (a later, shorter lead time was due first): nothing went out, and it never will.
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['user_id', 'created_at']);
        });

        Schema::table('vehicles', function (Blueprint $table) {
            // The highest mileage the owner gave or logged; km reminders count from it. Owner-only.
            $table->unsignedInteger('odometer_km')->nullable()->after('hu_au_reminded_for');
            $table->timestamp('odometer_at')->nullable()->after('odometer_km');
        });

        Schema::table('users', function (Blueprint $table) {
            // SET-11 (09 §8.11): display units; the server keeps km, Nm and kg.
            $table->string('distance_unit', 5)->default('km')->after('power_display');
            $table->string('torque_unit', 5)->default('nm')->after('distance_unit');
            $table->string('weight_unit', 5)->default('kg')->after('torque_unit');
            // SET-23 (MNT-03): what the member changed of the reminder defaults; read merged over MaintenancePrefs::DEFAULTS.
            $table->json('maintenance_prefs')->nullable()->after('weight_unit');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['distance_unit', 'torque_unit', 'weight_unit', 'maintenance_prefs']);
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropColumn(['odometer_km', 'odometer_at']);
        });

        Schema::dropIfExists('maintenance_reminders');
        Schema::dropIfExists('maintenance_logs');
        Schema::dropIfExists('maintenance_items');
    }
};
