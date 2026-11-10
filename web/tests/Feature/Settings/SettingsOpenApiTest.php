<?php

/**
 * The shapes the mobile client maps in M2.5 (m2.5-api-handover). Fails when a resource and its exported schema drift apart.
 */
beforeEach(function () {
    // Exported once per process: the export takes seconds and the routes do not change between these cases.
    static $spec = null;

    if ($spec === null) {
        $path = storage_path('framework/testing/m25-openapi-'.getmypid().'.json');
        test()->artisan('scramble:export', ['--path' => $path])->assertSuccessful();
        $spec = json_decode((string) file_get_contents($path), true);
        @unlink($path);
    }

    $this->spec = $spec;
});

it('documents the M2.5 routes', function (string $path, string $method) {
    expect($this->spec['paths'][$path][$method] ?? null)->not->toBeNull("$method $path");
})->with([
    ['/me/email', 'post'], ['/me/email/confirm', 'post'], ['/me/password', 'post'],
    ['/me/two-factor', 'post'], ['/me/two-factor', 'delete'], ['/me/two-factor/confirm', 'post'], ['/me/two-factor/recovery-codes', 'post'],
    ['/me/sessions', 'get'], ['/me/sessions', 'delete'], ['/me/sessions/{session}', 'delete'],
    ['/me/export', 'post'], ['/me/exports', 'get'], ['/me/exports/{export}/download', 'get'], ['/me/delete', 'post'],
    ['/help', 'get'], ['/help/{key}', 'get'], ['/support/tickets', 'post'], ['/auth/two-factor/challenge', 'post'],
]);

it('types the new resources exactly', function (string $schema, array $properties) {
    expect(array_keys($this->spec['components']['schemas'][$schema]['properties'] ?? []))->toBe($properties);
})->with([
    ['TwoFactorSetupResource', ['secret', 'otpauth_url', 'qr_svg']],
    ['RecoveryCodesResource', ['recovery_codes']],
    ['TwoFactorChallengeResource', ['two_factor_required', 'challenge', 'expires_in']],
    ['DeviceSessionResource', ['id', 'kind', 'device_name', 'platform', 'app_version', 'last_used_at', 'current']],
    ['DataExportResource', ['id', 'status', 'requested_at', 'ready_at', 'expires_at', 'bytes', 'download_url']],
    ['EmailChangeResource', ['email', 'resend_after_seconds']],
    ['HelpArticleSummaryResource', ['key', 'title', 'locale']],
    ['HelpArticleResource', ['key', 'title', 'locale', 'body_md', 'updated_at']],
    ['SupportTicketResource', ['id', 'reference', 'category', 'subject', 'status', 'created_at']],
]);

it('lets sign-in answer a session or a two-factor challenge', function (string $path) {
    $schema = json_encode($this->spec['paths'][$path]['post']['responses']['200']);

    expect($schema)->toContain('AuthSessionResource')->toContain('TwoFactorChallengeResource');
})->with(['/auth/login', '/auth/email/verify']);

it('adds the privacy fields and two_factor_enabled', function () {
    expect(array_keys($this->spec['components']['schemas']['MemberSettingsResource']['properties']))->toContain('who_can_message', 'discoverable', 'indexable', 'read_receipts')
        ->and(array_keys($this->spec['components']['schemas']['MeResource']['properties']))->toContain('two_factor_enabled');
});

it('documents the fields of DELETE me/two-factor as a JSON body, never as query parameters', function () {
    $operation = $this->spec['paths']['/me/two-factor']['delete'];

    expect($operation['parameters'] ?? [])->toBe([])
        ->and(array_keys($operation['requestBody']['content']['application/json']['schema']['properties']))->toBe(['password', 'code'])
        ->and($operation['requestBody']['content']['application/json']['schema']['required'])->toBe(['password', 'code']);
});

it('types recovery codes as a string list and the cooldown as an integer', function () {
    expect($this->spec['components']['schemas']['RecoveryCodesResource']['properties']['recovery_codes']['type'])->toBe('array')
        ->and($this->spec['components']['schemas']['RecoveryCodesResource']['properties']['recovery_codes']['items']['type'])->toBe('string')
        ->and($this->spec['components']['schemas']['EmailChangeResource']['properties']['resend_after_seconds']['type'])->toBe('integer');
});
