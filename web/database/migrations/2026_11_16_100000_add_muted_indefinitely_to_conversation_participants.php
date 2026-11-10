<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M2.8 [SIG sig.msg_organize]: MSG-01's "Bis du es wieder änderst" mutes a conversation with no end. In the API that is `muted: true` with
 * `muted_until: null`; here a flag beside muted_until, which stays the end of a timed mute. A TIMESTAMP cannot hold a far-future
 * stand-in (it ends in 2038), and a flag keeps "muted with no end" apart from "not muted".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->boolean('muted_indefinitely')->default(false)->after('muted_until');
        });
    }

    public function down(): void
    {
        Schema::table('conversation_participants', function (Blueprint $table) {
            $table->dropColumn('muted_indefinitely');
        });
    }
};
