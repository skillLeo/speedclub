<?php

use App\Enums\BusinessStatus;
use App\Enums\ModTagStatus;
use App\Models\BusinessInvite;
use App\Models\BusinessMember;
use App\Models\ModBusinessTag;
use App\Models\User;
use App\Services\DataExport\ExportContents;

require_once __DIR__.'/BusinessTestHelpers.php';

/**
 * SEC-414-11 (Art. 15/20 GDPR): the data export carries the member's business data: the application (Impressum, document note, status,
 * the reason staff gave), the team, open invitations, and the portfolio tags on the member's mods and those they decided.
 */
beforeEach(function () {
    bizFlags();
});

it('exports an applicant’s business with the application, the team and the tags', function () {
    $owner = User::factory()->create(['username' => 'jana.werkstatt']);
    $business = bizBusiness($owner, ['status' => BusinessStatus::Rejected, 'document_note' => 'Handelsregisterauszug liegt vor.', 'review_reason' => 'Registernummer passt nicht.']);
    $staff = User::factory()->create(['username' => 'tom.schrauber']);
    BusinessMember::factory()->create(['business_id' => $business->id, 'user_id' => $staff->id]);
    $member = User::factory()->create();
    $mod = bizBuildWithMod($member);
    ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $business->id, 'status' => ModTagStatus::Declined, 'requested_by' => $member->id, 'decided_by' => $owner->id, 'decided_at' => now()]);

    $documents = app(ExportContents::class)->documents($owner);
    $json = json_encode($documents['business.json'], JSON_THROW_ON_ERROR);

    expect($documents)->toHaveKeys(['business.json', 'business_tags.json'])
        ->and($documents['business.json']['membership']['role'])->toBe('owner')
        ->and($documents['business.json']['membership']['application'])->toMatchArray(['legal_name' => $business->legal_name, 'document_note' => 'Handelsregisterauszug liegt vor.', 'review_reason' => 'Registernummer passt nicht.', 'status' => 'rejected'])
        ->and(collect($documents['business.json']['membership']['team'])->pluck('username')->all())->toBe(['jana.werkstatt', 'tom.schrauber'])
        ->and($json)->not->toContain('reviewed_by')->not->toContain('verified_by')
        ->and($documents['business_tags.json']['decided_for_business'])->toHaveCount(1)
        ->and($documents['business_tags.json']['decided_for_business'][0])->not->toHaveKey('mod');

    $memberDocs = app(ExportContents::class)->documents($member);
    expect($memberDocs['business_tags.json']['on_my_mods'][0])->toMatchArray(['mod' => 'Teil', 'status' => 'declined', 'initiated_by' => 'member'])
        ->and($memberDocs['business.json']['membership'])->toBeNull();

    // Staff of the team: the business and the role only; an invitee: the invitation.
    expect(app(ExportContents::class)->documents($staff)['business.json']['membership'])->toMatchArray(['role' => 'staff'])->not->toHaveKey('application');
    BusinessInvite::factory()->create(['business_id' => $business->id, 'user_id' => $member->id]);
    expect(app(ExportContents::class)->documents($member)['business.json']['invitations'][0]['business'])->toBe($business->name);
});

it('names the business files in the README of the export', function (string $locale) {
    $files = trans('settings.export.readme.files', [], $locale);

    expect($files)->toHaveKeys(['business.json', 'business_tags.json']);
})->with(['de', 'en']);
