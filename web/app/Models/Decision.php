<?php

namespace App\Models;

use App\Enums\DecisionAction;
use App\Enums\DecisionOutcome;
use App\Enums\DecisionRestriction;
use App\Enums\GroundDocument;
use App\Enums\RedressOption;
use App\Enums\ReportTargetType;
use App\Support\Moderation\AppealDeadline;
use Carbon\CarbonImmutable;
use Database\Factories\DecisionFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Carbon;

/**
 * A moderation decision with its statement of reasons (Art. 17 DSA, ADM-21). Written only by App\Actions\Moderation\DecideCase.
 *
 * restriction: {type: messaging|publishing|suspension, until: ISO 8601|null} for restrict and suspend, else null.
 * statement_of_reasons: {facts, ground, ground_document: community|terms|law, ground_section: string|null, automated_detection: bool,
 * automated_decision: bool, redress: list<internal_complaint|out_of_court|court>}. mailed_at: when the statement-of-reasons mail left.
 *
 * @property string $id
 * @property string $case_id
 * @property string|null $subject_id
 * @property string|null $reverses_decision_id the decision a `reverse` decision lifts (M3.2)
 * @property array<string, mixed>|null $restore what a remove_content decision changed, for its reversal; internal
 * @property DecisionAction $action
 * @property array{type?: string, until?: string|null}|null $restriction
 * @property array<string, mixed> $statement_of_reasons
 * @property int|null $decided_by
 * @property Carbon $decided_at
 * @property Carbon|null $notified_at
 * @property Carbon|null $mailed_at
 */
class Decision extends Model
{
    /** @use HasFactory<DecisionFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'action' => DecisionAction::class,
            'restriction' => 'array',
            'statement_of_reasons' => 'array',
            'restore' => 'array',
            'decided_at' => 'datetime',
            'notified_at' => 'datetime',
            'mailed_at' => 'datetime',
        ];
    }

    /**
     * End of the appeal period: §§ 187(1), 188(2), (3) BGB in Europe/Berlin, from the notification. Null until notified.
     */
    public function appealUntil(): ?CarbonImmutable
    {
        return $this->notified_at === null ? null : AppealDeadline::from(CarbonImmutable::instance($this->notified_at));
    }

    /**
     * What the case is about. The case always exists (cascading foreign key); a member target is only the type's fallback.
     */
    public function targetType(): ReportTargetType
    {
        $case = $this->case;

        return $case instanceof ModerationCase ? $case->target_type : ReportTargetType::Member;
    }

    public function restrictionType(): ?DecisionRestriction
    {
        $type = $this->restriction['type'] ?? null;

        return is_string($type) ? DecisionRestriction::tryFrom($type) : null;
    }

    public function restrictionUntil(): ?CarbonImmutable
    {
        $until = $this->restriction['until'] ?? null;

        return is_string($until) ? CarbonImmutable::parse($until) : null;
    }

    public function facts(): string
    {
        return is_string($this->statement_of_reasons['facts'] ?? null) ? $this->statement_of_reasons['facts'] : '';
    }

    public function ground(): string
    {
        return is_string($this->statement_of_reasons['ground'] ?? null) ? $this->statement_of_reasons['ground'] : '';
    }

    public function groundDocument(): GroundDocument
    {
        $value = $this->statement_of_reasons['ground_document'] ?? null;

        return (is_string($value) ? GroundDocument::tryFrom($value) : null) ?? GroundDocument::Law;
    }

    public function groundSection(): ?string
    {
        $value = $this->statement_of_reasons['ground_section'] ?? null;

        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * Art. 17(3)(c) DSA: automated means found the content.
     */
    public function automatedDetection(): bool
    {
        return ($this->statement_of_reasons['automated_detection'] ?? false) === true;
    }

    /**
     * Art. 17(3)(c) DSA: automated means took the decision.
     */
    public function automatedDecision(): bool
    {
        return ($this->statement_of_reasons['automated_decision'] ?? false) === true;
    }

    public function outcome(): DecisionOutcome
    {
        return DecisionOutcome::of($this->action);
    }

    /**
     * @return list<RedressOption>
     */
    public function redress(): array
    {
        // A reversal lifts a measure: there is nothing to seek redress against.
        if ($this->action === DecisionAction::Reverse) {
            return [];
        }

        $values = $this->statement_of_reasons['redress'] ?? null;
        $options = is_array($values) ? array_values(array_filter(array_map(fn (mixed $value): ?RedressOption => is_string($value) ? RedressOption::tryFrom($value) : null, $values))) : [];

        return $options === [] ? RedressOption::cases() : $options;
    }

    /**
     * @return BelongsTo<ModerationCase, $this>
     */
    public function case(): BelongsTo
    {
        return $this->belongsTo(ModerationCase::class, 'case_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_id')->withTrashed();
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function decider(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'decided_by');
    }

    /**
     * @return BelongsTo<Decision, $this>
     */
    public function reverses(): BelongsTo
    {
        return $this->belongsTo(Decision::class, 'reverses_decision_id');
    }

    /**
     * The reverse decision that lifted this one, if any.
     *
     * @return HasOne<Decision, $this>
     */
    public function reversal(): HasOne
    {
        return $this->hasOne(Decision::class, 'reverses_decision_id');
    }

    public function isReversed(): bool
    {
        return self::query()->where('reverses_decision_id', $this->id)->exists();
    }

    /**
     * @return HasMany<Appeal, $this>
     */
    public function appeals(): HasMany
    {
        return $this->hasMany(Appeal::class);
    }
}
