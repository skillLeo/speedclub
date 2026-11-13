<?php

/**
 * M2.8 fix round: the Blade forms WEB-05 /konto-loeschen, WEB-09 /melden and WEB-10 /kontakt draw §8's controls with tokens (DQ-425),
 * their selects sit on the type scale (DQ-408), and "Passwort vergessen?" is a 44 target (DQ-407).
 */
beforeEach(fn () => $this->withHeader('Accept-Language', 'de'));

function publicCss(): string
{
    return (string) file_get_contents(resource_path('css/public.css'));
}

/**
 * @return string the CSS rule body of $selector, exactly as written
 */
function publicCssRule(string $selector): string
{
    preg_match('/(?:^|\n)'.preg_quote($selector, '/').'\s*\{([^}]*)\}/', publicCss(), $rule);

    return $rule[1] ?? '';
}

it('labels every field in callout in the secondary ink and puts hints and field errors in caption (2.0 roles, ADR-419)', function (string $uri) {
    $html = (string) $this->get($uri)->assertOk()->getContent();

    preg_match_all('/<(?:label for|legend)[^>]*class="([^"]*)"/', $html, $labels);
    preg_match_all('/<p id="[^"]+-hint" class="([^"]*)"/', $html, $hints);

    preg_match_all('/<p id="[^"]+-error" class="([^"]*)"/', $html, $errors);

    expect($labels[1])->not->toBeEmpty()->each->toContain('text-callout text-ink-2')
        ->and($html)->not->toContain('class="text-body-strong text-ink"');

    foreach ($hints[1] as $hint) {
        expect($hint)->toBe('text-caption text-ink-3');
    }

    foreach ($errors[1] as $error) {
        expect($error)->toContain('sc-form-error')->toContain('text-caption');
    }
})->with(['/melden', '/kontakt', '/konto-loeschen']);

it('draws radios and checkboxes as §8 controls with tokens, on native inputs', function (string $uri, string $selector) {
    $html = (string) $this->get($uri)->assertOk()->getContent();

    expect($html)->toMatch('/<input[^>]+type="(radio|checkbox)"[^>]+class="sc-focus sc-form-(radio|check)"/');
    expect($html)->toContain($selector);
})->with([
    'WEB-09 radios' => ['/melden', 'class="sc-focus sc-form-radio"'],
    'WEB-09 checkbox' => ['/melden', 'class="sc-focus sc-form-check"'],
    'WEB-05 checkbox' => ['/konto-loeschen', 'class="sc-focus sc-form-check"'],
]);

it('styles the controls with appearance none, 22 visual, the control border and an inverse checked state', function () {
    $base = publicCssRule('.sc-form-radio, .sc-form-check');

    expect($base)->toContain('appearance: none;')
        ->toContain('width: 22px;')->toContain('height: 22px;')
        ->toContain('border: 1px solid var(--color-line-control);')
        ->not->toContain('accent-color')
        ->and(publicCssRule('.sc-form-radio'))->toContain('border-radius: 9999px;')
        ->and(publicCssRule('.sc-form-check'))->toContain('border-radius: 4px;')
        ->and(publicCssRule('.sc-form-radio:checked, .sc-form-check:checked'))->toContain('background: var(--color-inverse);')
        ->and(publicCssRule('.sc-form-radio::before, .sc-form-check::before'))->toContain('background: var(--color-ink-inverse);')
        // The row around a control stays the 44 target.
        ->and(publicCssRule('.sc-form-option'))->toContain('min-height: 44px;')
        ->and(publicCss())->toContain('@media (forced-colors: active)');
    // Tokens only: no raw colour in the control rules.
    expect(preg_match('/\.sc-form-(radio|check)[^{]*\{[^}]*#[0-9a-fA-F]{3,8}/', publicCss()))->toBe(0);
});

it('draws its own focus ring on the controls in the focus token, also where WebKit drops :focus-visible on the arrow keys', function () {
    $ring = 'outline: 2px solid var(--color-focus); outline-offset: 2px;';

    // :focus-visible for Tab in every engine; :focus unless a pointer press marked the document, for WebKit's arrow keys in a group.
    expect(publicCssRule('.sc-form-radio:focus-visible, .sc-form-check:focus-visible,'."\n".':root:not([data-sc-pointer]) .sc-form-radio:focus, :root:not([data-sc-pointer]) .sc-form-check:focus'))
        ->toBe(' '.$ring.' ');

    $script = (string) file_get_contents(resource_path('js/public/app.ts'));
    expect($script)->toContain("addEventListener('pointerdown', () => root.setAttribute('data-sc-pointer', ''), true)")
        ->toContain("addEventListener('keydown', () => root.removeAttribute('data-sc-pointer'), true)")
        ->toMatch('/^pointerFocus\(\);$/m');

    // Every radio and checkbox of the three forms carries the class the ring is drawn on.
    foreach (['/melden', '/kontakt', '/konto-loeschen'] as $uri) {
        preg_match_all('/<input[^>]+type="(?:radio|checkbox)"[^>]*>/', (string) $this->get($uri)->getContent(), $controls);

        foreach ($controls[0] as $control) {
            expect($control)->toMatch('/class="sc-focus sc-form-(radio|check)"/');
        }
    }
});

it('draws the selects like the input on the type scale, with the caret icon beside them', function (string $uri, string $testId) {
    $html = (string) $this->get($uri)->assertOk()->getContent();

    expect($html)->toMatch('/<div class="sc-form-select-wrap">\s*<select [^>]*class="sc-focus sc-form-input sc-form-select text-input"[^>]*data-testid="'.preg_quote($testId, '/').'"/')
        ->toContain('class="shrink-0 sc-form-select-caret"');
    expect(publicCssRule('.sc-form-select'))->toContain('appearance: none;');
})->with([
    'WEB-09' => ['/melden', 'WEB-09.subReason'],
    'WEB-10' => ['/kontakt', 'WEB-10.category'],
]);

it('gives "Passwort vergessen?" a 44 high target that does not stretch over the column', function () {
    $html = (string) $this->get('/konto-loeschen')->assertOk()->getContent();

    preg_match('/<a [^>]*data-testid="WEB-05.forgot"[^>]*>/', $html, $link);

    expect($link[0] ?? '')->toContain('inline-flex min-h-44 items-center justify-self-start');
});

it('sets every text field in the input role (16/24), so iOS Safari never zooms into a form (ADR-420)', function (string $uri) {
    $html = (string) $this->get($uri)->assertOk()->getContent();

    preg_match_all('/<(?:input|select|textarea)[^>]*class="([^"]*sc-form-input[^"]*)"/', $html, $fields);

    expect($fields[1])->not->toBeEmpty()->each->toContain('text-input')
        ->and($html)->not->toMatch('/sc-form-input[^"]*text-body/');
})->with(['/melden', '/kontakt', '/konto-loeschen']);
