<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SEC-414 fix round (docs/reports/security/phase-4-m414-m417.md):
 * - business_invites (SEC-414-01): the owner invites a member to the team; the member accepts or declines. Only an accepted invite
 *   becomes a business_members row, so a pending invite never gives a role, never blocks the member's own application (one business
 *   per member counts business_members only) and never confirms a portfolio tag. One open invite per business and member; several
 *   businesses may invite the same member.
 * - businesses.version (SEC-414-07): a monotonic integer raised on every write, the optimistic lock of ADM-55/56 (updated_at had whole
 *   seconds only).
 * Plain columns and an index for every foreign key: MySQL 8 and MariaDB 10.6+. Reversible.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_invites', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('business_id')->constrained()->cascadeOnDelete();
            // The invited member.
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['business_id', 'user_id']);
            $table->index(['user_id', 'created_at']);
            $table->index('invited_by');
        });

        Schema::table('businesses', function (Blueprint $table) {
            $table->unsignedInteger('version')->default(1)->after('is_sample');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn('version');
        });

        Schema::dropIfExists('business_invites');
    }
};
