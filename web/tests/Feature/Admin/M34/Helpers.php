<?php

use App\Actions\Moderation\SubmitReport;
use App\Enums\KeywordList;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Models\KeywordRule;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Models\User;
use App\Services\Moderation\ReportDraft;
use App\Services\Moderation\ReportTargets;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;

require_once __DIR__.'/../M32/Helpers.php';
require_once __DIR__.'/../../Moderation/ModerationTestHelpers.php';

/**
 * M3.4 admin tests (lane b). Functions are prefixed adm34 so they never collide with another suite's helpers.
 */
function adm34Rule(string $term, KeywordList $list): KeywordRule
{
    $rule = new KeywordRule;
    $rule->forceFill(['term' => $term, 'normalized' => KeywordNormaliser::term($term), 'list' => $list])->save();
    app(KeywordRules::class)->flush();

    return $rule;
}

/** An open case about a vehicle of a fresh member, reported by another member. */
function adm34VehicleCase(ReportReason $reason = ReportReason::Spam): ModerationCase
{
    $vehicle = modVehicle(User::factory()->create());

    return modCaseOf(modReport(User::factory()->create(), ReportTargetType::Vehicle, $vehicle->id, $reason));
}

/**
 * An open case about a message: $reporter reports the last of three messages $sender wrote to them, with the stored context.
 *
 * @return array{0: ModerationCase, 1: User, 2: User}
 */
function adm34MessageCase(): array
{
    $sender = User::factory()->create(['username' => 'marco.adm34']);
    $reporter = User::factory()->create(['username' => 'aylin.adm34']);
    $first = msgStart($sender, $reporter, 'Na, fährst du den FK8 selbst?');
    msgSend($reporter, $first->conversation_id, 'Ja, seit drei Jahren.');
    $insult = msgSend($sender, $first->conversation_id, 'Bleib lieber auf dem Supermarktparkplatz, du Lusche.');

    $report = app(SubmitReport::class)->handle(
        app(ReportTargets::class)->forMember($reporter, ReportTargetType::Message, $insult->id),
        new ReportDraft(source: ReportSource::App, reporter: $reporter, reason: ReportReason::Harassment, details: 'Beleidigt mich nach meiner Antwort.', messageContext: true),
    );

    return [modCaseOf($report), $sender, $reporter];
}

/** Staff of a role, signed in with a fresh password confirmation; seeds the roles first. */
function adm34As(string $role): Staff
{
    return adm32SignedIn($role);
}

/** The statement-of-reasons fields with an audit reason, as the composer posts them. */
function adm34Decision(string $action, array $overrides = []): array
{
    return [
        'action' => $action,
        ...($action === 'no_action' ? [] : adm32Statement()),
        'reason' => adm32Reason(),
        ...$overrides,
    ];
}

/** Every key of a nested array, flattened (to assert that a key never appears anywhere in props). */
function adm34Keys(array $data): array
{
    $keys = [];
    array_walk_recursive($data, function ($value, $key) use (&$keys): void {
        $keys[] = $key;
    });
    foreach ($data as $key => $value) {
        $keys[] = $key;
        if (is_array($value)) {
            $keys = [...$keys, ...adm34Keys($value)];
        }
    }

    return array_unique($keys);
}
