<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Enums\DevicePlatform;
use App\Models\PersonalAccessToken;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Support\ViewAs;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-10 "Ansicht als" (`members.view_as`, m3.2-contract §3): a Sanctum token of the member, name `view-as:<staff id>`, the single
 * ability `view-as`, 30 minutes. RestrictViewAs keeps it read-only and away from messages. A Support staff member needs the member's
 * consent ($memberConsented, the checkbox "Mitglied hat zugestimmt"); others may note it. One view-as per staff member and member: a
 * new start ends the previous token. Audited `member.view_as_started` with the reason, the consent and the end (the token id as
 * access_id: Audit redacts keys that say token).
 *
 * Returns the plain token once and the URL the admin opens in a new tab: the token travels in the fragment, so it never reaches a
 * server log or the address bar's query (the app drops the fragment at once and keeps the token in sessionStorage).
 *
 * @return array{token: string, url: string, expires_at: string, token_id: int}
 *
 * @throws AuthorizationException|ValidationException|DomainException for a closed account
 */
class StartViewAs
{
    /**
     * @return array{token: string, url: string, expires_at: string, token_id: int}
     */
    public function handle(Staff $staff, User $member, string $reason, bool $memberConsented): array
    {
        StaffAtoms::ensure($staff, 'members.view_as');

        if ($staff->hasRole('support') && ! $staff->hasAnyRole(['owner', 'admin']) && ! $memberConsented) {
            throw ValidationException::withMessages(['member_consented' => [(string) __('validation.accepted', ['attribute' => 'member_consented'])]]);
        }

        if ($member->trashed() || $member->isPendingDeletion()) {
            throw new DomainException('A closed account cannot be viewed.');
        }

        $expires = CarbonImmutable::now()->addMinutes(ViewAs::MINUTES);

        return DB::transaction(function () use ($staff, $member, $reason, $memberConsented, $expires): array {
            User::query()->whereKey($member->id)->lockForUpdate()->value('id');
            $name = ViewAs::NAME_PREFIX.$staff->getKey();

            $ended = $member->tokens()->where('name', $name)->delete();
            $new = $member->createToken($name, [ViewAs::ABILITY], $expires);

            /** @var PersonalAccessToken $token */
            $token = $new->accessToken;
            $token->forceFill(['device_name' => 'SPEED CLUB Team', 'platform' => DevicePlatform::Web])->save();

            Audit::record(AdminMemberEvent::ViewAsStarted->value, $member, after: [
                'access_id' => $token->getKey(),
                'member_consented' => $memberConsented,
                'expires_at' => $expires->toIso8601String(),
                'replaced' => $ended,
            ], reason: trim($reason), actor: $staff);

            $fragment = http_build_query(['view_as' => $new->plainTextToken, 'staff' => $staff->name], '', '&', PHP_QUERY_RFC3986);

            return [
                'token' => $new->plainTextToken,
                'url' => rtrim(config()->string('app.url'), '/').'/app/#'.$fragment,
                'expires_at' => $expires->toIso8601String(),
                'token_id' => (int) $token->getKey(),
            ];
        });
    }
}
