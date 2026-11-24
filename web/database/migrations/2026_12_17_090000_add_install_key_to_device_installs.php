<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-511 (amends ADR-435, M5.9b ADM-62): the install without the member (DeviceInstalls::installKey, app key only) on each member's
 * install row, so the Spots admin can show "Gleiches Gerät" when several spotting accounts signed in on one app install. Read only by
 * App\Services\Admin\Spots\SharedDevices (member ids and counts out, never the key); never in an API answer, the data export or the
 * admin pages. Filled at the next sign-in or token rotation of an install (no backfill: the plain install id is not stored anywhere).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_installs', function (Blueprint $table): void {
            $table->char('install_key', 64)->nullable()->after('install_id_hash');
            $table->index('install_key', 'device_installs_install_key_index');
        });
    }

    public function down(): void
    {
        Schema::table('device_installs', function (Blueprint $table): void {
            $table->dropIndex('device_installs_install_key_index');
            $table->dropColumn('install_key');
        });
    }
};
