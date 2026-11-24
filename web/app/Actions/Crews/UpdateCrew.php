<?php

namespace App\Actions\Crews;

use App\Enums\CrewAuditEvent;
use App\Enums\CrewJoinMode;
use App\Models\Crew;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Crews\CrewMemberships;
use App\Services\Crews\CrewNames;
use BackedEnum;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * PATCH crews/{slug} (contract-crews.md §3 #9): founder and admins change name, description, Bundesland and join mode; only the keys
 * sent change. A new name gets a new slug; the old one stays as previous_slug, so shared links keep working (C7). Switching to `open`
 * leaves open requests as they are (admins still decide them).
 */
class UpdateCrew
{
    public function __construct(private readonly CrewFields $fields, private readonly CrewMemberships $memberships) {}

    /**
     * @param  array{name?: string, description?: string|null, bundesland?: string|null, join_mode?: string}  $input
     */
    public function handle(User $by, Crew $crew, array $input): Crew
    {
        CrewFields::assertActive($crew);
        $changes = [];
        $screened = ['name' => null, 'description' => null];

        if (array_key_exists('name', $input)) {
            $name = CrewNames::normalise($input['name']);

            if ($name !== $crew->name) {
                if (CrewNames::key($name) !== $crew->name_key) {
                    $this->fields->assertName($name, $crew);
                    $changes['name_key'] = CrewNames::key($name);
                }

                $changes['name'] = $name;
                $screened['name'] = $name;

                // Only a name that reads differently in a link gets a new slug ("Nordlicht crew" keeps nordlicht-crew).
                if (Str::slug($name) !== Str::slug($crew->name)) {
                    $changes['slug'] = CrewNames::slugFor($name, $crew);
                    $changes['previous_slug'] = $crew->slug;
                }
            }
        }

        if (array_key_exists('description', $input)) {
            $changes['description'] = $screened['description'] = CreateCrew::text($input['description']);
        }

        if (array_key_exists('bundesland', $input)) {
            $changes['bundesland'] = $input['bundesland'];
        }

        if (array_key_exists('join_mode', $input)) {
            $changes['join_mode'] = CrewJoinMode::from($input['join_mode']);
        }

        $flags = $this->fields->screen($screened);

        try {
            DB::transaction(function () use ($by, $crew, $changes): void {
                // SF-2: hidden or deleted meanwhile → 409, checked on the locked row.
                CrewFields::assertActive($this->memberships->lockCrew($crew));
                $crew->forceFill($changes);

                if (! $crew->isDirty()) {
                    return;
                }

                $before = array_intersect_key($crew->getOriginal(), $crew->getDirty());
                $crew->save();
                Audit::record(CrewAuditEvent::Updated->value, $crew, self::plain($before), self::plain($crew->getChanges()), actor: $by);
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['name' => [(string) __('crews.name_taken')]]);
        }

        $this->fields->flagAfterCommit($flags, $crew);

        return $crew;
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private static function plain(array $values): array
    {
        unset($values['updated_at'], $values['name_key']);

        return array_map(fn (mixed $value): mixed => $value instanceof BackedEnum ? $value->value : $value, $values);
    }
}
