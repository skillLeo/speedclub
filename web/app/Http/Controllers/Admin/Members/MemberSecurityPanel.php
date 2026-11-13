<?php

namespace App\Http\Controllers\Admin\Members;

use App\Models\MemberPasskey;
use App\Models\SecurityEvent;
use App\Models\SocialAccount;
use App\Models\User;

/**
 * ADM-59 Mitglied-Sicherheit (09 §10.3, M4.17): what the "Sicherheit & Sitzungen" tab of ADM-10 adds to the M3.2 two-factor state and
 * devices — the member's passkeys, linked sign-in providers and security events. Read-only (revoking sessions is ADM-10's action).
 * Staff never see secrets: no credential, public key, credential id or provider subject; no provider e-mail (members.view_pii is
 * ADM-10's reveal) — only whether Apple's private relay is used; no IP (events keep a truncated one, which stays out too), only the
 * coarse city the event recorded.
 */
final class MemberSecurityPanel
{
    private const EVENTS = 50;

    /**
     * @return array{passkeys: list<array<string, mixed>>, providers: list<array<string, mixed>>, events: list<array<string, mixed>>}
     */
    public static function for(User $member): array
    {
        return [
            'passkeys' => array_values(MemberPasskey::query()->where('user_id', $member->id)->orderByDesc('created_at')->get()
                ->map(fn (MemberPasskey $passkey): array => [
                    'id' => $passkey->id,
                    'name' => $passkey->name,
                    'synced' => (bool) $passkey->getAttribute('backed_up'),
                    'created_at' => $passkey->created_at?->toIso8601String(),
                    'last_used_at' => $passkey->getAttribute('last_used_at')?->toIso8601String(),
                ])->all()),
            'providers' => array_values(SocialAccount::query()->where('user_id', $member->id)->orderBy('provider')->get()
                ->map(fn (SocialAccount $account): array => [
                    'id' => $account->id,
                    'provider' => $account->provider->value,
                    'private_relay' => (bool) $account->getAttribute('is_private_relay'),
                    'linked_at' => $account->created_at?->toIso8601String(),
                    'last_used_at' => $account->getAttribute('last_used_at')?->toIso8601String(),
                ])->all()),
            'events' => array_values(SecurityEvent::query()->where('user_id', $member->id)->orderByDesc('created_at')->limit(self::EVENTS)->get()
                ->map(fn (SecurityEvent $event): array => [
                    'id' => $event->id,
                    'type' => $event->type->value,
                    'device_name' => $event->device_name,
                    'platform' => $event->platform?->value,
                    'approx_city' => $event->approx_city,
                    'created_at' => $event->created_at->toIso8601String(),
                ])->all()),
        ];
    }
}
