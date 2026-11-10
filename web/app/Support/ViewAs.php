<?php

namespace App\Support;

use App\Enums\AdminMemberEvent;
use App\Models\PersonalAccessToken;
use App\Models\Staff;
use App\Models\User;
use App\Services\Audit\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

/**
 * View-as (ADM-10, m3.2-contract §3): a Sanctum token of the member with the single ability `view-as`, named `view-as:<staff id>`,
 * valid for 30 minutes. Only reading: RestrictViewAs refuses every write and every message route for it, and nothing a GET does on
 * the member's behalf may change their data (activity counters, scans, codes). A member token holds the ability `member` instead,
 * never `*`, so `can('view-as')` is false for it.
 */
final class ViewAs
{
    public const ABILITY = 'view-as';

    public const NAME_PREFIX = 'view-as:';

    public const MINUTES = 30;

    private const REQUEST_ATTRIBUTE = 'speedclub.view_as_token';

    public static function isToken(mixed $token): bool
    {
        if (! $token instanceof PersonalAccessToken) {
            return false;
        }

        $abilities = $token->getAttribute('abilities');

        return is_array($abilities) && in_array(self::ABILITY, $abilities, true) && str_starts_with((string) $token->getAttribute('name'), self::NAME_PREFIX);
    }

    /**
     * The view-as token the request carries as its bearer, whether or not the route authenticates; null for anything else. Expired
     * ones count too: a stale view-as tab must not fall through to a write that a public route would take from a guest.
     */
    public static function tokenOf(Request $request): ?PersonalAccessToken
    {
        if ($request->attributes->has(self::REQUEST_ATTRIBUTE)) {
            $found = $request->attributes->get(self::REQUEST_ATTRIBUTE);

            return $found instanceof PersonalAccessToken ? $found : null;
        }

        $bearer = $request->bearerToken();
        $found = null;

        if (is_string($bearer) && $bearer !== '') {
            /** @var class-string<PersonalAccessToken> $model */
            $model = Sanctum::$personalAccessTokenModel;
            $token = $model::findToken($bearer);
            $found = self::isToken($token) ? $token : null;
        }

        $request->attributes->set(self::REQUEST_ATTRIBUTE, $found);

        return $found;
    }

    /**
     * Whether the current request is a view-as one. For writers that run on GETs (scan counts, activity) and have only the container.
     */
    public static function active(): bool
    {
        if (! app()->bound('request')) {
            return false;
        }

        return self::tokenOf(app('request')) !== null;
    }

    /**
     * Ends every view-as a staff member started (SEC-P3-07): on their suspension or deactivation and on any change of their
     * credentials. One delete; `member.view_as_ended` per member, with $endedBy (staff_inactive, staff_credentials_changed).
     */
    public static function revokeStartedBy(Staff $staff, string $endedBy): int
    {
        return DB::transaction(function () use ($staff, $endedBy): int {
            $query = PersonalAccessToken::query()->where('name', self::NAME_PREFIX.$staff->getKey());
            $members = (clone $query)->where('tokenable_type', (new User)->getMorphClass())->pluck('tokenable_id')->unique();
            $deleted = $query->delete();

            foreach ($members as $id) {
                $member = User::withTrashed()->find($id);

                if ($member instanceof User) {
                    Audit::record(AdminMemberEvent::ViewAsEnded->value, $member, after: ['ended_by' => $endedBy], actor: $staff);
                }
            }

            return $deleted;
        });
    }

    /**
     * Whether the staff member behind the token may still look (active): RestrictViewAs answers 401 otherwise (SEC-P3-07).
     */
    public static function staffStillActive(PersonalAccessToken $token): bool
    {
        return self::staffOf($token)?->isActive() === true;
    }

    public static function staffOf(PersonalAccessToken $token): ?Staff
    {
        $id = substr((string) $token->getAttribute('name'), strlen(self::NAME_PREFIX));

        return ctype_digit($id) ? Staff::query()->find((int) $id) : null;
    }
}
