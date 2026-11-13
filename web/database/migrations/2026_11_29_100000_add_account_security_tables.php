<?php

use App\Enums\MemberSecurityEvent;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * M4.7 account security (09 §8.4, §11). device_installs: one row per app install and member, the install id only as a keyed hash.
     * member_security_events: what SET-21 reads; every row is also in the audit log. No IP address in either (ADR-113, ADR-429 c):
     * approx_city stays empty until a GeoLite2 database is configured (OA-33).
     */
    public function up(): void
    {
        Schema::create('device_installs', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->char('install_id_hash', 64);
            $table->string('platform', 10)->nullable();
            $table->string('model', 120)->nullable();
            $table->string('os_version', 40)->nullable();
            $table->string('app_version', 32)->nullable();
            $table->string('approx_city', 80)->nullable();
            $table->timestamp('first_seen_at')->useCurrent();
            $table->timestamp('last_seen_at')->useCurrent();

            $table->unique(['user_id', 'install_id_hash']);
            $table->index('last_seen_at');
        });

        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->foreignUlid('device_install_id')->nullable()->after('device_id')->constrained('device_installs')->nullOnDelete();
            $table->string('approx_city', 80)->nullable()->after('app_version');
        });

        Schema::create('member_security_events', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('type', 60);
            $table->foreignUlid('device_install_id')->nullable()->constrained('device_installs')->nullOnDelete();
            $table->string('device_name', 120)->nullable();
            $table->string('platform', 10)->nullable();
            $table->string('approx_city', 80)->nullable();
            $table->json('meta')->nullable();
            $table->timestamp('created_at', 6)->useCurrent();

            $table->index(['user_id', 'created_at']);
            $table->index(['user_id', 'type', 'created_at']);
            $table->index('created_at');
        });

        $this->backfill();
    }

    public function down(): void
    {
        Schema::dropIfExists('member_security_events');

        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropConstrainedForeignId('device_install_id');
            $table->dropColumn('approx_city');
        });

        Schema::dropIfExists('device_installs');
    }

    /**
     * SET-21 starts with the last 12 months of the audit log, so existing members see their history. Only the device name and platform
     * are taken from the audit row; nothing else of it.
     */
    private function backfill(): void
    {
        if (! Schema::hasTable('audit_events')) {
            return;
        }

        $types = array_map(fn (MemberSecurityEvent $event): string => $event->value, MemberSecurityEvent::cases());

        DB::table('audit_events')
            ->join('users', 'users.id', '=', 'audit_events.target_id')
            ->where('audit_events.target_type', 'user')
            ->whereIn('audit_events.action', $types)
            ->where('audit_events.occurred_at', '>=', now()->subMonths(12))
            ->orderBy('audit_events.id')
            ->select(['audit_events.id', 'audit_events.target_id', 'audit_events.action', 'audit_events.after', 'audit_events.occurred_at'])
            ->chunk(500, function ($rows): void {
                $insert = [];

                foreach ($rows as $row) {
                    $after = is_string($row->after) ? json_decode($row->after, true) : null;
                    $after = is_array($after) ? $after : [];

                    $insert[] = [
                        'id' => (string) Str::ulid(),
                        'user_id' => $row->target_id,
                        'type' => $row->action,
                        'device_name' => is_string($after['device_name'] ?? null) ? mb_substr($after['device_name'], 0, 120) : null,
                        'platform' => is_string($after['platform'] ?? null) ? mb_substr($after['platform'], 0, 10) : null,
                        'meta' => null,
                        'created_at' => $row->occurred_at,
                    ];
                }

                DB::table('member_security_events')->insert($insert);
            });
    }
};
