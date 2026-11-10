<?php

use App\Enums\DecisionAction;
use App\Enums\ReportTargetType;
use App\Mail\ModerationDecisionMail;
use App\Mail\ReportOutcomeMail;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Mail;

require_once __DIR__.'/ModerationTestHelpers.php';

/**
 * M2.8: every decision and appeal date in a mail is a date only (d.m.Y, in every locale, like the app's SAFE-01), and a decision without
 * a notice time names the length of the appeal period instead of an empty date.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    $this->affected = User::factory()->create(['username' => 'tobi.quattro', 'locale' => 'de']);
    $this->reporter = User::factory()->create(['username' => 'nico.sti']);
});

/** The plain text of a rendered mail, so a date cannot hide in markup. */
function mailText(ModerationDecisionMail|ReportOutcomeMail $mail, string $locale): string
{
    return trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($mail->locale($locale)->render()))));
}

it('formats the appeal deadline and the end of a suspension date only, d.m.Y in German and English', function (string $locale) {
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00:00', 'UTC'));
    $case = modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro'));
    $decision = modDecide($case, DecisionAction::Suspend, ['until' => CarbonImmutable::parse('2026-12-24 15:30:00', 'UTC')]);

    $text = mailText(new ModerationDecisionMail($decision, ReportTargetType::Member, 'tobi.quattro'), $locale);

    expect($text)->toContain('10.05.2027')
        ->and($text)->toContain('24.12.2026')
        ->and($text)->not->toMatch('/\b\d{1,2}:\d{2}\b/')
        ->and($text)->not->toContain('May 2027')
        ->and($text)->not->toContain('December 2026');
})->with(['de', 'en']);

it('formats the notifier\'s deadline date only as well', function (string $locale) {
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00:00', 'UTC'));
    $decision = modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::NoAction);

    $text = mailText(new ReportOutcomeMail($decision, 'ref-1'), $locale);

    expect($text)->toContain('10.05.2027')->and($text)->not->toMatch('/\b\d{1,2}:\d{2}\b/');
})->with(['de', 'en']);

it('names the six-month period instead of an empty date when the decision has no notice time', function (DecisionAction $action, string $locale, string $period) {
    $case = modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro'));
    $decision = modDecide($case, $action, $action === DecisionAction::Suspend ? ['until' => CarbonImmutable::now()->addMonth()] : []);
    $decision->notified_at = null;
    expect($decision->appealUntil())->toBeNull();

    $text = mailText(new ModerationDecisionMail($decision, ReportTargetType::Member, 'tobi.quattro'), $locale);
    $outcome = mailText(new ReportOutcomeMail($decision, 'ref-1'), $locale);

    expect(substr_count($text, $period))->toBe(2)
        ->and($outcome)->toContain($period)
        // The old empty date: "bis zum  Einspruch", "bis zum  an", "until . Another", "by  in the app".
        ->and($text.$outcome)->not->toMatch('/(bis zum|until|by)\s+(an\b|in\b|Einspruch|and\b|\.)/u')
        ->and($text.$outcome)->not->toContain(':date')
        ->and($text.$outcome)->not->toContain(':months');
})->with([
    'remove, de' => [DecisionAction::RemoveContent, 'de', 'innerhalb von 6 Monaten ab dieser Nachricht'],
    'remove, en' => [DecisionAction::RemoveContent, 'en', 'within 6 months of this message'],
    'suspend, de' => [DecisionAction::Suspend, 'de', 'innerhalb von 6 Monaten ab dieser Nachricht'],
    'suspend, en' => [DecisionAction::Suspend, 'en', 'within 6 months of this message'],
]);
