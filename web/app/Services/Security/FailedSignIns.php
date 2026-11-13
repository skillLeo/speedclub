<?php

namespace App\Services\Security;

use App\Enums\MemberSecurityEvent;
use App\Models\SecurityEvent;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * SET-21 "Fehlgeschlagene Anmeldeversuche" (09 §8.4): wrong proofs on an existing account as one row per account and day (Europe/Berlin)
 * with a count per step (password, email_code, second_factor). Only the first of a day is an audit event, so a guessing attacker cannot
 * flood the audit chain. Recorded after the response (later()), so a wrong password costs a known address no more time than an unknown
 * one (LoginMember answers both alike).
 */
final class FailedSignIns
{
    public const STEPS = ['password', 'email_code', 'second_factor'];

    /**
     * @param  value-of<self::STEPS>  $step
     */
    public function later(User $user, string $step): void
    {
        $id = (string) $user->getKey();

        // The same after-the-response step as the auth mails (AuthMailer, ADR-130): one per request, failures logged by class only.
        app(AuthMailer::class)->afterResponse(fn () => $this->record($id, $step));
    }

    /**
     * @param  value-of<self::STEPS>  $step
     */
    public function record(string $userId, string $step): void
    {
        $user = User::query()->find($userId);

        if ($user === null) {
            return;
        }

        $since = CarbonImmutable::now(config()->string('speedclub.notifications.timezone'))->startOfDay()->utc();

        DB::transaction(function () use ($user, $step, $since): void {
            $row = $user->securityEvents()
                ->where('type', MemberSecurityEvent::SignInFailed)
                ->where('created_at', '>=', $since)
                ->lockForUpdate()
                ->first();

            if ($row instanceof SecurityEvent) {
                $meta = $row->meta ?? [];
                $steps = is_array($meta['steps'] ?? null) ? $meta['steps'] : [];
                $steps[$step] = (int) ($steps[$step] ?? 0) + 1;
                $row->forceFill(['meta' => ['count' => (int) ($meta['count'] ?? 0) + 1, 'steps' => $steps, 'last_at' => now()->toIso8601String()]])->save();

                return;
            }

            $row = new SecurityEvent(['type' => MemberSecurityEvent::SignInFailed, 'meta' => ['count' => 1, 'steps' => [$step => 1], 'last_at' => now()->toIso8601String()]]);
            $row->forceFill(['user_id' => $user->getKey(), 'created_at' => now()])->save();

            Audit::record(MemberSecurityEvent::SignInFailed->value, $user, after: ['step' => $step]);
        });
    }
}
