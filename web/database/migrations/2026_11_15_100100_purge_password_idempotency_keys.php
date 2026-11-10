<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * SEC-P2-01: until M2.8 the fingerprint of POST me/export was a bare SHA-256 over its input, which is the member's password. Those rows
 * go; the routes that take a password or a code and carry `idempotent` are this one only (routes/api/v1/me.php). A retry of an export
 * asked for just before the deploy then runs again and meets RequestDataExport's 24-hour lock instead of a replay.
 */
return new class extends Migration
{
    public const ROUTES = ['POST api/v1/me/export'];

    public function up(): void
    {
        DB::table('idempotency_keys')->whereIn('route', self::ROUTES)->delete();
    }

    public function down(): void
    {
        // Nothing to restore.
    }
};
