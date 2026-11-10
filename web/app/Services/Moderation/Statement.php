<?php

namespace App\Services\Moderation;

use App\Enums\GroundDocument;
use Illuminate\Validation\Rule;
use InvalidArgumentException;

/**
 * The statement of reasons a staff member writes for a decision taken from the admin (Art. 17(3) DSA, m3.2-contract §1): the facts and
 * the ground in their own words, and where the ground is written. The admin's SoR templates fill it; the member reads it on SAFE-01 and
 * in the decision mail. A reversal needs only the facts (why the measure ends).
 */
final readonly class Statement
{
    public function __construct(
        public string $facts,
        public string $ground,
        public GroundDocument $groundDocument,
        public ?string $groundSection = null,
    ) {
        if (trim($facts) === '') {
            throw new InvalidArgumentException('A statement of reasons states the facts.');
        }
    }

    /**
     * @param  array<string, mixed>  $values  facts, ground, ground_document, ground_section? (an admin form or an approval payload)
     */
    public static function fromArray(array $values): self
    {
        $string = fn (string $key): string => is_string($values[$key] ?? null) ? $values[$key] : '';
        $section = $values['ground_section'] ?? null;

        return new self(
            facts: $string('facts'),
            ground: $string('ground'),
            groundDocument: GroundDocument::tryFrom($string('ground_document')) ?? GroundDocument::Community,
            groundSection: is_string($section) && trim($section) !== '' ? trim($section) : null,
        );
    }

    /**
     * @return array{facts: string, ground: string, ground_document: string, ground_section: string|null}
     */
    public function toArray(): array
    {
        return [
            'facts' => $this->facts,
            'ground' => $this->ground,
            'ground_document' => $this->groundDocument->value,
            'ground_section' => $this->groundSection,
        ];
    }

    /**
     * The validation rules of the fields fromArray() reads, for FormRequests and approval handlers.
     *
     * @return array<string, list<mixed>>
     */
    public static function rules(string $prefix = '', bool $groundRequired = true): array
    {
        return [
            $prefix.'facts' => ['required', 'string', 'min:10', 'max:5000'],
            $prefix.'ground' => [$groundRequired ? 'required' : 'nullable', 'string', 'min:3', 'max:2000'],
            $prefix.'ground_document' => [$groundRequired ? 'required' : 'nullable', Rule::enum(GroundDocument::class)],
            $prefix.'ground_section' => ['nullable', 'string', 'max:100'],
        ];
    }
}
