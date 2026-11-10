<?php

namespace App\Http\Resources\V1;

use App\Enums\OnboardingStep;
use App\Enums\PowerDisplay;
use App\Enums\RestrictionType;
use App\Enums\ThemePreference;
use App\Models\User;
use App\Services\Auth\MemberStats;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The signed-in member, for that member only. auth/me, me/profile and sign-ins all return this, so the app has one shape.
 *
 * @property User $resource
 */
class MeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $member = $this->resource;
        $avatar = $member->avatar;
        $cover = $member->cover;
        $stats = app(MemberStats::class)->for($member, asOwner: true);

        return [
            'id' => $member->id,
            'email' => $member->email,
            'email_verified' => $member->hasVerifiedEmail(),
            'has_username' => $member->hasUsername(),
            'profile_complete' => $member->hasCompletedProfileSetup(),
            /** @var OnboardingStep|null The first open step of onboarding; null when it is done. */
            'next_step' => $member->onboardingStep(),
            'force_password_change' => $member->getAttribute('force_password_change') === true,
            'username' => $member->username,
            /** @var string|null When the next username change is possible; null when one is possible now. */
            'username_change_available_at' => $member->usernameChangeAvailableAt()?->toIso8601String(),
            /** @var string|null */
            'display_name' => $member->getAttribute('display_name'),
            /** @var string|null */
            'city' => $member->getAttribute('city'),
            /** @var string|null */
            'bio' => $member->getAttribute('bio'),
            /** @var MediaResource|null */
            'avatar' => $avatar === null ? null : new MediaResource($avatar),
            /** @var MediaResource|null */
            'cover' => $cover === null ? null : new MediaResource($cover),
            /** @var string */
            'locale' => $member->getAttribute('locale'),
            /** @var ThemePreference */
            'theme' => $member->getAttribute('theme'),
            /** @var PowerDisplay */
            'power_display' => $member->getAttribute('power_display'),
            /** @var string */
            'member_since' => $member->created_at?->toIso8601String(),
            /** @var array{vehicles: int, followers: int, following: int} */
            'stats' => $stats,
            /** M2.5 SET-05: two-factor is on, so sign-in, SET-13 and switching it off ask for a code. */
            'two_factor_enabled' => $member->hasTwoFactor(),
            'restrictions' => [
                'suspended' => $member->isSuspended(),
                'messaging' => $this->restriction(RestrictionType::Messaging),
                'publishing' => $this->restriction(RestrictionType::Publishing),
            ],
        ];
    }

    /**
     * decision_id (M2.6): the moderation decision behind the restriction in force (a suspension's when suspended), so restricted screens
     * can open SAFE-01. Null when none is in force or it was not set by a decision.
     *
     * @return array{restricted: bool, until: string|null, decision_id: string|null}
     */
    private function restriction(RestrictionType $type): array
    {
        $member = $this->resource;
        $restricted = $member->isRestrictedFrom($type);
        $key = $member->isSuspended() ? 'suspension' : $type->value;
        $decision = $member->restrictions[$key]['decision_id'] ?? null;

        return [
            'restricted' => $restricted,
            'until' => $member->restrictedUntil($type)?->toIso8601String(),
            'decision_id' => $restricted && is_string($decision) ? $decision : null,
        ];
    }
}
