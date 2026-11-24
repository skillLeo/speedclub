<?php

use App\Services\Crews\CrewRepair;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * R4DQ-21 (round-4 design review): crews whose members' accounts were hard-deleted outside DeleteAccount (the unverified-account delete,
 * the showcase purge, test cleanups) stayed "Aktiv" with their old members_count and no founder. CrewRepair hands such a crew to its
 * oldest admin or member, ends a crew nobody is left in, and recounts every crew. Data only, idempotent (a second run finds nothing), no
 * schema change; audited with the system as actor. Nothing to undo: the hand-overs and ends are what C8 would have done.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('crews') || ! Schema::hasTable('crew_members')) {
            return;
        }

        app(CrewRepair::class)->run();
    }

    public function down(): void
    {
        // A repair is not undone: the counts are facts, and the founders and ends are what account deletion does since C8.
    }
};
