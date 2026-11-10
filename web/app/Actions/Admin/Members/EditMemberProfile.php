<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Auth\UsernameAvailability;
use App\Services\PublicPages\OgImages;
use App\Services\Search\VehicleSearchProjector;
use App\Support\Username;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * ADM-10 edit drawer (`members.edit`, recent password): display name, bio, city, and the username (format and reserved words checked by
 * the FormRequest, availability and the unique index here). Never the password. Only the keys present change; null clears a text. A
 * staff username change keeps the old name as previous_username (as a member's own change does) and leaves the member's 30-day
 * cooldown alone. Audited with before and after of what changed.
 *
 * @param  array{display_name?: string|null, bio?: string|null, city?: string|null, username?: string}  $changes  validated
 *
 * @throws AuthorizationException|ValidationException
 */
class EditMemberProfile
{
    private const TEXTS = ['display_name', 'bio', 'city'];

    public function __construct(
        private readonly UsernameAvailability $availability,
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
    ) {}

    /**
     * @param  array{display_name?: string|null, bio?: string|null, city?: string|null, username?: string}  $changes
     */
    public function handle(Staff $staff, User $member, array $changes, string $reason): User
    {
        StaffAtoms::ensure($staff, 'members.edit');

        try {
            $result = DB::transaction(function () use ($staff, $member, $changes, $reason): array {
                $locked = User::query()->whereKey($member->id)->lockForUpdate()->firstOrFail();
                $before = [];
                $after = [];

                foreach (self::TEXTS as $field) {
                    if (! array_key_exists($field, $changes)) {
                        continue;
                    }

                    $value = is_string($changes[$field]) && trim($changes[$field]) !== '' ? trim($changes[$field]) : null;

                    if ($value !== $locked->getAttribute($field)) {
                        $before[$field] = $locked->getAttribute($field);
                        $after[$field] = $value;
                        $locked->forceFill([$field => $value]);
                    }
                }

                if (isset($changes['username'])) {
                    $username = Username::normalize($changes['username']);

                    if ($username !== $locked->username) {
                        if ($this->availability->reason($username, $locked) !== null) {
                            throw ValidationException::withMessages(['username' => [(string) __('username.taken')]]);
                        }

                        $before['username'] = $locked->username;
                        $after['username'] = $username;
                        $locked->forceFill(['previous_username' => $locked->username]);
                        $locked->username = $username;
                    }
                }

                if ($after !== []) {
                    $locked->save();
                    Audit::record(AdminMemberEvent::ProfileEdited->value, $locked, $before, $after, trim($reason), $staff);
                }

                $member->setRawAttributes($locked->getAttributes(), true);

                return $after;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['username' => [(string) __('username.taken')]]);
        }

        if ($result !== []) {
            $this->refreshPublicFace($member, isset($result['username']));
        }

        return $member;
    }

    /**
     * The share image shows the name; search knows the owner's username.
     */
    private function refreshPublicFace(User $member, bool $renamed): void
    {
        try {
            $this->og->purge($member);
            $this->og->queue($member);

            if ($renamed) {
                Vehicle::query()->where('owner_id', $member->id)->get()->each(fn (Vehicle $vehicle) => $this->search->queue($vehicle));
            }
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
