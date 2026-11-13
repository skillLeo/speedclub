<?php

use App\Enums\AuditActorType;
use App\Enums\MemberSecurityEvent;
use App\Services\Auth\DeviceInstalls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * M4.7 security review (SEC-M47-03, -05, -08).
 *
 * - member_security_events.secured_at: a "Das war ich nicht" link is single use as a mark on its event, no longer through the credential
 *   epoch an intruder can turn (SEC-M47-05, -07).
 * - Install ids are stored only as keyed hashes that include the member (DeviceInstalls::key), in personal_access_tokens.device_id,
 *   push_tokens.device_id, device_installs and the token fingerprints of known_devices; two accounts of one phone share no value
 *   (SEC-M47-03). push_tokens.install_key (DeviceInstalls::installKey) lets a sign-in on a phone end the previous member's push token
 *   there; one install has at most one push token row at any time, so it joins nothing across accounts.
 * - Backfilled SET-21 rows of staff actions get meta.by_staff from the audit row's actor (SEC-M47-08).
 *
 * The hashing cannot be undone (the raw ids are gone); down() only drops the new columns.
 */
return new class extends Migration
{
    private const HASH = '/\A[0-9a-f]{64}\z/';

    public function up(): void
    {
        Schema::table('member_security_events', function (Blueprint $table) {
            $table->timestamp('secured_at')->nullable();
        });

        Schema::table('push_tokens', function (Blueprint $table) {
            $table->char('install_key', 64)->nullable()->index();
        });

        $this->hashTokens();
        $this->hashPushTokens();
        $this->markStaffEvents();
    }

    public function down(): void
    {
        Schema::table('push_tokens', function (Blueprint $table) {
            $table->dropIndex(['install_key']);
            $table->dropColumn('install_key');
        });

        Schema::table('member_security_events', function (Blueprint $table) {
            $table->dropColumn('secured_at');
        });
    }

    private function hashTokens(): void
    {
        DB::table('personal_access_tokens')->whereNotNull('device_id')->where('tokenable_type', 'user')->orderBy('id')
            ->chunkById(500, function ($tokens): void {
                foreach ($tokens as $token) {
                    $raw = (string) $token->device_id;

                    if (preg_match(self::HASH, $raw) === 1) {
                        continue;
                    }

                    $user = (string) $token->tokenable_id;
                    $key = DeviceInstalls::key($user, $raw);
                    DB::table('personal_access_tokens')->where('id', $token->id)->update(['device_id' => $key]);

                    // The install's row and the device's known fingerprint follow, so neither looks new at the next sign-in.
                    $legacy = DeviceInstalls::legacyHash($raw);

                    if (! DB::table('device_installs')->where('user_id', $user)->where('install_id_hash', $key)->exists()) {
                        DB::table('device_installs')->where('user_id', $user)->where('install_id_hash', $legacy)->update(['install_id_hash' => $key]);
                    }

                    $oldPrint = hash('sha256', 'token-id|'.mb_strtolower($raw));
                    $newPrint = DeviceInstalls::fingerprint($user, $raw);

                    if (! DB::table('known_devices')->where('user_id', $user)->where('fingerprint', $newPrint)->exists()) {
                        DB::table('known_devices')->where('user_id', $user)->where('fingerprint', $oldPrint)->update(['fingerprint' => $newPrint]);
                    }
                }
            });
    }

    private function hashPushTokens(): void
    {
        DB::table('push_tokens')->whereNotNull('device_id')->orderBy('id')->chunkById(500, function ($rows): void {
            foreach ($rows as $row) {
                $raw = (string) $row->device_id;

                if (preg_match(self::HASH, $raw) === 1) {
                    continue;
                }

                DB::table('push_tokens')->where('id', $row->id)->update([
                    'device_id' => DeviceInstalls::key((string) $row->user_id, $raw),
                    'install_key' => DeviceInstalls::installKey($raw),
                ]);
            }
        });
    }

    /**
     * Rows of 2026_11_29_100000's backfill are matched to their audit row by member, type and moment (both kept to the microsecond).
     */
    private function markStaffEvents(): void
    {
        $types = array_map(fn (MemberSecurityEvent $event): string => $event->value, MemberSecurityEvent::cases());

        DB::table('audit_events')
            ->where('target_type', 'user')
            ->where('actor_type', AuditActorType::Staff->value)
            ->whereIn('action', $types)
            ->where('occurred_at', '>=', now()->subMonths(12))
            ->orderBy('id')
            ->select(['id', 'target_id', 'action', 'occurred_at'])
            ->chunkById(500, function ($rows): void {
                foreach ($rows as $row) {
                    $events = DB::table('member_security_events')
                        ->where('user_id', $row->target_id)
                        ->where('type', $row->action)
                        ->where('created_at', $row->occurred_at)
                        ->get(['id', 'meta']);

                    foreach ($events as $event) {
                        $meta = is_string($event->meta) ? json_decode($event->meta, true) : null;
                        $meta = is_array($meta) ? $meta : [];

                        if (($meta['by_staff'] ?? false) === true) {
                            continue;
                        }

                        DB::table('member_security_events')->where('id', $event->id)->update([
                            'meta' => json_encode([...$meta, 'by_staff' => true]),
                            // A staff action names no device of the member (SecurityEventLog).
                            'device_name' => null,
                            'platform' => null,
                        ]);
                    }
                }
            });
    }
};
