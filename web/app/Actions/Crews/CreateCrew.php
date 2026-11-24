<?php

namespace App\Actions\Crews;

use App\Enums\CrewAuditEvent;
use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Models\Crew;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Crews\CrewMemberships;
use App\Services\Crews\CrewNames;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * POST crews (contract-crews.md §3 #8): the member founds a crew and is its founder. At most founded_max crews founded and
 * memberships_max memberships (409 limit_reached), checked under the member's row lock. A crew of a sample member is a sample.
 */
class CreateCrew
{
    public function __construct(private readonly CrewFields $fields, private readonly CrewMemberships $memberships) {}

    /**
     * @param  array{name: string, description: string|null, bundesland: string|null, join_mode: string}  $input
     */
    public function handle(User $founder, array $input): Crew
    {
        $name = CrewNames::normalise($input['name']);
        $description = self::text($input['description']);
        $this->fields->assertName($name);
        $flags = $this->fields->screen(['name' => $name, 'description' => $description]);

        try {
            $crew = DB::transaction(function () use ($founder, $name, $description, $input): Crew {
                $this->memberships->lockMember($founder);
                $this->memberships->assertMayFound($founder);
                $this->memberships->assertMayJoin($founder);

                $crew = new Crew;
                $crew->forceFill([
                    'name' => $name,
                    'name_key' => CrewNames::key($name),
                    'slug' => CrewNames::slugFor($name),
                    'description' => $description,
                    'bundesland' => $input['bundesland'],
                    'join_mode' => CrewJoinMode::from($input['join_mode']),
                    'status' => CrewStatus::Active,
                    'members_count' => 0,
                    'is_sample' => $founder->getAttribute('is_sample') === true,
                ])->save();

                $this->memberships->add($crew, $founder, CrewRole::Founder);
                Audit::record(CrewAuditEvent::Created->value, $crew, null, ['name' => $crew->name, 'join_mode' => $crew->join_mode->value], actor: $founder);

                return $crew;
            });
        } catch (UniqueConstraintViolationException) {
            // Somebody took the name (or its slug) in the same moment.
            throw ValidationException::withMessages(['name' => [(string) __('crews.name_taken')]]);
        }

        $this->fields->flagAfterCommit($flags, $crew);

        return $crew;
    }

    public static function text(?string $text): ?string
    {
        if ($text === null) {
            return null;
        }

        $text = trim(str_replace(["\r\n", "\r"], "\n", $text));

        return $text === '' ? null : $text;
    }
}
