<?php

namespace App\Actions\Crews;

use App\Enums\CrewStatus;
use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Exceptions\ApiException;
use App\Models\Crew;
use App\Services\Crews\CrewNames;
use App\Services\Rules\ContentScreen;
use Illuminate\Validation\ValidationException;

/**
 * The checks CreateCrew and UpdateCrew share (contract-crews.md §4): the name's characters, reserved words and case-insensitive
 * uniqueness (422 on `name`), and the keyword rules on name and description (block list: 422 content_blocked; flag list: matches
 * returned for the automated report after the commit).
 */
final class CrewFields
{
    public function __construct(private readonly ContentScreen $screen) {}

    public function assertName(string $name, ?Crew $except = null): void
    {
        $min = config()->integer('speedclub.crews.name_min');
        $max = config()->integer('speedclub.crews.name_max');
        $length = mb_strlen($name);

        if ($length < $min || $length > $max) {
            self::fail((string) __('crews.name_length', ['min' => $min, 'max' => $max]));
        }

        if (! CrewNames::hasAllowedCharacters($name)) {
            self::fail((string) __('crews.name_characters'));
        }

        if (CrewNames::isReserved($name)) {
            self::fail((string) __('crews.name_reserved'));
        }

        if (CrewNames::isTaken($name, $except)) {
            self::fail((string) __('crews.name_taken'));
        }
    }

    private static function fail(string $message): never
    {
        throw ValidationException::withMessages(['name' => [$message]]);
    }

    /**
     * @param  array<string, string|null>  $texts  field => text (name, description)
     * @return list<array{field: KeywordField, rules: list<array{id: int, term: string, list: string}>}>
     */
    public function screen(array $texts): array
    {
        $fields = [];

        foreach ($texts as $field => $text) {
            if ($text !== null && $text !== '') {
                $fields[$field] = [KeywordField::CrewText, $text];
            }
        }

        return $fields === [] ? [] : $this->screen->screen($fields);
    }

    /**
     * @param  list<array{field: KeywordField, rules: list<array{id: int, term: string, list: string}>}>  $flags
     */
    public function flagAfterCommit(array $flags, Crew $crew): void
    {
        $this->screen->flagAfterCommit($flags, $crew);
    }

    /**
     * Edits, invitations and joins need an active crew; a hidden one only lets its members leave and its founder delete it.
     *
     * @throws ApiException 409 conflict
     */
    public static function assertActive(Crew $crew): void
    {
        if ($crew->status !== CrewStatus::Active || $crew->trashed()) {
            throw new ApiException(ErrorCode::Conflict, (string) __('crews.not_active'));
        }
    }
}
