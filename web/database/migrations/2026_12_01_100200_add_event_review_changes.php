<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M4.12 security review (SEC-412-01): what the organiser changed on a published event that has to be reviewed again (a private place,
 * or one of the organiser's first events): the field names, shown in the ADM-53 queue as "geändert seit der Freigabe", cleared by the
 * next decision. Reversible.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->json('review_changes')->nullable()->after('reviewed_at');
        });
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropColumn('review_changes');
        });
    }
};
