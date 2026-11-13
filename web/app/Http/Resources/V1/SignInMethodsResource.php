<?php

namespace App\Http\Resources\V1;

use App\Enums\SocialProvider;
use App\Models\SocialAccount;
use App\Support\Security\SignInMethodsSummary;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-19 Anmeldung & Passkeys (09 §7.9): every way into the account at a glance. Details and changes stay with me/passkeys, me/providers,
 * me/password and me/two-factor. `available` is the feature flag: a method that is off is not offered (an existing link still shows).
 *
 * @property SignInMethodsSummary $resource
 */
class SignInMethodsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $summary = $this->resource;

        return [
            /** Always on (ADR-407). `reachable` is false for an Apple private relay address until OA-34: then it is no way in. */
            'email_code' => [
                'available' => true,
                'email' => $summary->user->email,
                'reachable' => $summary->mailboxReachable,
            ],
            'password' => [
                'set' => $summary->user->hasPassword(),
                /** Password sign-in offered (`auth.password_login`). */
                'available' => $summary->flags['auth.password_login'] ?? false,
            ],
            'two_factor' => [
                'enabled' => $summary->user->hasTwoFactor(),
            ],
            /** @var list<array{provider: SocialProvider, available: bool, linked: bool, email: string|null, linked_at: string|null, last_used_at: string|null}> Apple, then Google. */
            'providers' => array_map(function (SocialProvider $provider) use ($summary): array {
                /** @var SocialAccount|null $account */
                $account = $summary->providers->first(fn (SocialAccount $linked): bool => $linked->provider === $provider);

                return [
                    'provider' => $provider,
                    'available' => $summary->flags[$provider->flag()] ?? false,
                    'linked' => $account !== null,
                    'email' => $account?->getAttribute('email'),
                    'linked_at' => $account?->created_at?->toIso8601String(),
                    'last_used_at' => $account?->getAttribute('last_used_at')?->toIso8601String(),
                ];
            }, SocialProvider::cases()),
            'passkeys' => [
                'available' => $summary->flags['auth.passkeys'] ?? false,
                'count' => $summary->passkeys,
            ],
            /** Ways in besides the e-mail code: password, passkeys, providers. */
            'other_methods' => ($summary->user->hasPassword() ? 1 : 0) + $summary->passkeys + $summary->providers->count(),
        ];
    }
}
