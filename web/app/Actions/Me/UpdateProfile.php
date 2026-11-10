<?php

namespace App\Actions\Me;

use App\Enums\KeywordField;
use App\Models\User;
use App\Services\Rules\ContentScreen;

class UpdateProfile
{
    public function __construct(private readonly ContentScreen $screen) {}

    /**
     * Any call ends the profile step of onboarding, so "Überspringen" (AUTH-09) is an empty PATCH.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function handle(User $user, array $attributes): User
    {
        // M3.4 (ADM-23): keyword rules on the bio and the display name (block: 422 content_blocked; flag: an automated report).
        $fields = [];
        foreach (['bio' => KeywordField::ProfileBio, 'display_name' => KeywordField::ProfileDisplayName] as $key => $kind) {
            if (is_string($attributes[$key] ?? null)) {
                $fields[$key] = [$kind, $attributes[$key]];
            }
        }
        $flags = $this->screen->screen($fields);

        $user->fill($attributes);
        $user->forceFill(['profile_setup_at' => $user->getAttribute('profile_setup_at') ?? now()]);
        $user->save();
        $this->screen->flagAfterCommit($flags, $user);

        return $user;
    }
}
