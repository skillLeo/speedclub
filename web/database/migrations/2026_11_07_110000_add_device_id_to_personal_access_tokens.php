<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A per-install id the app sends at sign-in and rotation. The model name alone made two phones of the same model one device,
     * so each sign-in ended the other (recheck round 3). Not unique: right after a rotation a device holds two tokens.
     */
    public function up(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->string('device_id', 64)->nullable()->after('device_name');
            $table->index(['tokenable_id', 'device_id']);
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropIndex(['tokenable_id', 'device_id']);
            $table->dropColumn('device_id');
        });
    }
};
