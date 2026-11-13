<?php

/**
 * M2.6 routes in the export, typed enough for the mobile client (`api/queries/safety.ts` maps them onto the SafetyAdapter view models).
 */
function safetyOpenApiDocument(): array
{
    $path = tempnam(sys_get_temp_dir(), 'openapi');
    test()->artisan('scramble:export', ['--path' => $path])->assertSuccessful();
    $document = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    unlink($path);

    return $document;
}

it('documents the safety routes with typed resources and their error bodies', function () {
    $document = safetyOpenApiDocument();
    $paths = $document['paths'];
    $schemas = $document['components']['schemas'];
    $refs = fn (array $response): array => array_map(
        fn (array $schema): string => $schema['$ref'] ?? '',
        $response['content']['application/json']['schema']['anyOf'] ?? [$response['content']['application/json']['schema']],
    );

    expect($paths['/reports']['post']['responses'][201]['content']['application/json']['schema']['properties']['data']['$ref'])->toBe('#/components/schemas/ReportReceiptResource')
        ->and($refs($paths['/reports']['post']['responses'][409]))->toContain('#/components/schemas/AlreadyReportedError')
        ->and($refs($paths['/reports']['post']['responses'][422]))->toContain('#/components/schemas/OwnContentError')
        ->and($paths['/me/reports']['get']['responses'][200]['content']['application/json']['schema']['properties']['data']['items']['$ref'])->toBe('#/components/schemas/ReportSummaryResource')
        ->and($paths['/me/decisions']['get']['responses'][200]['content']['application/json']['schema']['properties']['data']['items']['$ref'])->toBe('#/components/schemas/DecisionSummaryResource')
        ->and($paths['/decisions/{decision}']['get']['responses'][200]['content']['application/json']['schema']['properties']['data']['$ref'])->toBe('#/components/schemas/DecisionResource')
        ->and($paths['/decisions/{decision}']['get']['responses'])->toHaveKey(404)
        ->and($paths['/decisions/{decision}/appeal']['post']['responses'][201]['content']['application/json']['schema']['properties']['data']['$ref'])->toBe('#/components/schemas/AppealResource')
        ->and($refs($paths['/decisions/{decision}/appeal']['post']['responses'][409]))->toContain('#/components/schemas/AppealExistsError')
        ->and($refs($paths['/decisions/{decision}/appeal']['post']['responses'][422]))->toContain('#/components/schemas/AppealPeriodOverError');

    expect(array_keys($schemas['DecisionResource']['properties']))->toBe([
        // M3.2: origin (own-initiative cases) and reverses_decision_id (the reverse action).
        'id', 'viewer', 'action', 'outcome', 'origin', 'reverses_decision_id', 'restriction', 'scope', 'target', 'decided_at', 'notified_at', 'appeal_until', 'automated_detection',
        'automated_decision', 'redress', 'dispute_settlement_url', 'ground_document', 'ground_section', 'statement', 'appeal', 'can_appeal',
    ])
        ->and($schemas['DecisionViewer']['enum'])->toBe(['affected', 'reporter'])
        ->and($schemas['DecisionOutcome']['enum'])->toBe(['no_action', 'remove_content', 'measures', 'reversed'])
        ->and(array_keys($schemas['DecisionRefResource']['properties']))->toBe(['id', 'outcome', 'decided_at', 'appeal_status'])
        ->and($schemas['DecisionAction']['enum'])->toBe(['no_action', 'remove_content', 'restrict', 'suspend', 'reverse'])
        ->and($schemas['CaseOrigin']['enum'])->toBe(['report', 'staff'])
        ->and($schemas['ReportReason']['enum'])->toBe(['illegal', 'harassment', 'nudity', 'spam', 'impersonation', 'other'])
        ->and($schemas['IllegalSubReason']['enum'])->toBe(['street_racing', 'hate_speech', 'privacy', 'copyright', 'other_illegal'])
        ->and($schemas['ReportTargetType']['enum'])->toBe(['member', 'vehicle', 'photo', 'message', 'build_update', 'modification', 'comment', 'event'])
        ->and($schemas['ReportStatus']['enum'])->toBe(['received', 'in_review', 'decided'])
        ->and($schemas['AppealStatus']['enum'])->toBe(['open', 'upheld', 'reversed'])
        ->and($schemas['GroundDocument']['enum'])->toBe(['community', 'terms', 'law'])
        ->and($schemas['MeResource']['properties']['restrictions']['properties']['messaging']['properties'])->toHaveKey('decision_id')
        // The request body is typed for the client: no casts in api/queries/safety.ts.
        ->and($schemas['StoreReportRequest']['properties']['sub_reason'])->toBe(['$ref' => '#/components/schemas/IllegalSubReason'])
        ->and($schemas['StoreReportRequest']['properties']['message_context']['type'])->toBe('boolean')
        ->and($schemas['StoreReportRequest']['properties']['good_faith']['type'])->toBe('boolean')
        ->and($schemas['StoreReportRequest']['properties']['reason'])->toBe(['$ref' => '#/components/schemas/ReportReason'])
        ->and($schemas['StoreReportRequest']['required'])->toBe(['target_type', 'target_id', 'reason']);
});
