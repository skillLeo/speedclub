<?php

/**
 * DQ-669: every audit action the code can record has a German and an English label in lang/admin/{de,en}/audit.json
 * (`audit.actions.<action>`, read by actionLabel() on ADM-44 and every audit timeline), so no raw event key reaches a table.
 * The actions are every case of the audit event enums (app/Enums/*Event.php), every literal of Audit::record('…'), and every
 * EVENT constant of a class that records one.
 */

/** @return array<string, string> action => where it comes from */
function recordedAuditActions(): array
{
    $actions = [];

    foreach (glob(app_path('Enums/*Event.php')) ?: [] as $file) {
        $class = 'App\\Enums\\'.basename($file, '.php');

        foreach ($class::cases() as $case) {
            $actions[(string) $case->value] = $class;
        }
    }

    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path(), FilesystemIterator::SKIP_DOTS));

    foreach ($files as $file) {
        if (! $file instanceof SplFileInfo || $file->getExtension() !== 'php') {
            continue;
        }

        $source = (string) file_get_contents($file->getPathname());

        if (! str_contains($source, 'Audit::record(')) {
            continue;
        }

        $where = str_replace(base_path().'/', '', $file->getPathname());
        preg_match_all("/Audit::record\(\s*'([a-z0-9_.]+)'/", $source, $literals);
        preg_match_all("/const [A-Z_]*EVENT = '([a-z0-9_.]+)'/", $source, $constants);

        foreach ([...$literals[1], ...$constants[1]] as $action) {
            $actions[$action] = $where;
        }
    }

    ksort($actions);

    return $actions;
}

it('finds the audit actions the code records', function () {
    $actions = recordedAuditActions();

    // A smoke check of the scan itself: an enum case, a literal (on its own line) and a constant.
    expect($actions)->toHaveKeys(['config.preview_issued', 'moderation.decided', 'privacy.request_viewed', 'staff.pii_reveal_limit_reached', 'support.bulk_status'])
        ->and(count($actions))->toBeGreaterThan(150);
});

it('labels every recorded audit action in both locales', function (string $locale) {
    $labels = json_decode((string) file_get_contents(lang_path("admin/$locale/audit.json")), true, 64, JSON_THROW_ON_ERROR)['actions'];
    $missing = [];

    foreach (recordedAuditActions() as $action => $where) {
        $node = $labels;

        foreach (explode('.', $action) as $segment) {
            $node = is_array($node) && array_key_exists($segment, $node) ? $node[$segment] : null;
        }

        if (! is_string($node) || trim($node) === '') {
            $missing[] = "$action ($where)";
        }
    }

    expect($missing)->toBe([]);
})->with(['de', 'en']);
