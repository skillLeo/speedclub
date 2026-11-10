<?php

namespace App\Console\Commands;

use App\Actions\Moderation\DecideCase;
use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\RestrictionType;
use App\Enums\StaffStatus;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\Approvals\FourEyes;
use App\Services\Moderation\DecisionInput;
use App\Support\Moderation\AppealDeadline;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use InvalidArgumentException;
use ValueError;

/**
 * For operators until the Phase 3 admin (ADM-21) exists: decides one open case through DecideCase, with the same statement of reasons,
 * notifications and e-mail. Who decides is a named, active staff member (--operator, stored as decided_by and the audit actor) with a
 * mandatory --reason; a suspension also needs a second, different active staff member (--approved-by, four-eyes, M2.6 review #10).
 * --until takes an ISO 8601 moment, or a date, which then means the end of that day in Europe/Berlin. Never prints report content.
 */
#[Signature('speedclub:moderation:decide
    {case : The id of an open moderation case}
    {--action= : no_action, remove_content, restrict or suspend}
    {--restriction= : For restrict: messaging or publishing}
    {--until= : For restrict and suspend: end (ISO 8601, or a date = end of that day in Berlin); none means no end date}
    {--facts= : Facts and circumstances, in plain words (Art. 17(3)(b) DSA)}
    {--ground= : The ground, e.g. "Community-Richtlinien §3 (Nur Legales)"}
    {--document=community : community, terms or law}
    {--section= : The section of that document, e.g. 3}
    {--automated-detection : Automated means found the content}
    {--operator= : Required: the e-mail of the deciding staff member}
    {--approved-by= : For suspend: the e-mail of a second, different staff member who approved it}
    {--reason= : Required: why, for the audit log}')]
#[Description('Decide an open moderation case (DSA statement of reasons, notifications, audit)')]
class DecideModerationCaseCommand extends Command
{
    public function handle(DecideCase $decide): int
    {
        $reason = $this->optionText('reason');

        if ($reason === '') {
            $this->error('--reason is required: it goes to the audit log.');

            return self::INVALID;
        }

        $operator = $this->staff($this->optionText('operator'));

        if (! $operator instanceof Staff) {
            $this->error('--operator must be the e-mail of an active staff member: the decision is theirs.');

            return self::INVALID;
        }

        $approver = $this->optionText('approved-by') === '' ? null : $this->staff($this->optionText('approved-by'));

        if ($this->optionText('action') === DecisionAction::Suspend->value && (! $approver instanceof Staff || $approver->is($operator))) {
            $this->error('A suspension needs --approved-by: the e-mail of a second, different active staff member (four-eyes).');

            return self::INVALID;
        }

        $case = ModerationCase::query()->find(strtolower((string) $this->argument('case')));

        if (! $case instanceof ModerationCase) {
            $this->error((string) __('moderation.command.not_found'));

            return self::FAILURE;
        }

        try {
            $until = $this->optionText('until');
            $restriction = $this->optionText('restriction');
            $input = new DecisionInput(
                action: DecisionAction::from($this->optionText('action')),
                facts: $this->optionText('facts'),
                ground: $this->optionText('ground'),
                groundDocument: GroundDocument::from($this->optionText('document')),
                groundSection: $this->optionText('section') === '' ? null : $this->optionText('section'),
                automatedDetection: $this->option('automated-detection') === true,
                restriction: $restriction === '' ? null : RestrictionType::from($restriction),
                until: $until === '' ? null : $this->until($until),
                decidedBy: $operator,
                reason: $reason,
                approvedBy: $approver,
            );
            // ADR-206 a: operator and approver are named on the server's console; the one way to suspend outside an approval.
            $decision = FourEyes::asOperatorCommand(fn () => $decide->handle($case, $input));
        } catch (DomainException) {
            $this->error((string) __('moderation.command.not_open'));

            return self::FAILURE;
        } catch (InvalidArgumentException|ValueError $exception) {
            $this->error((string) __('moderation.command.invalid', ['message' => $exception->getMessage()]));

            return self::INVALID;
        }

        $this->info((string) __('moderation.command.decided', ['action' => $decision->action->value, 'id' => $decision->id]));

        return self::SUCCESS;
    }

    private function staff(string $email): ?Staff
    {
        return $email === '' ? null : Staff::query()->where('email', mb_strtolower($email))->where('status', StaffStatus::Active->value)->first();
    }

    /**
     * A date alone ("2026-12-01") is the end of that day in Berlin, as members count days; a moment keeps its own zone.
     */
    private function until(string $value): CarbonImmutable
    {
        return preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $value) === 1
            ? CarbonImmutable::parse($value, AppealDeadline::TIMEZONE)->endOfDay()->startOfSecond()
            : CarbonImmutable::parse($value);
    }

    private function optionText(string $option): string
    {
        $value = $this->option($option);

        return is_string($value) ? trim($value) : '';
    }
}
