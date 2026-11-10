<?php

use Illuminate\Support\Facades\Blade;

// The Blade avatar draws the same initials as the app's Avatar (initialsOf in mobile/src/ui/Avatar.tsx), which the
// parity test of WEB-01 against VEH-01 compares.
it('draws the initials of the first two words, like the app', function (string $name, string $expected) {
    $html = Blade::render('<x-public.avatar :name="$name" />', ['name' => $name]);

    expect($html)->toContain('>'.$expected.'</span>');
})->with([
    'display name' => ['Lukas Scholz', 'LS'],
    'username with a dot' => ['lukas.sc', 'LS'],
    'leading at sign' => ['@nina', 'N'],
    'three words' => ['Anna Lena Berg', 'AL'],
    'umlaut' => ['Özlem Ürün', 'ÖÜ'],
    'hyphen and underscore' => ['jann-peters_2', 'JP'],
]);

it('escapes the initials', function () {
    $html = Blade::render('<x-public.avatar :name="$name" />', ['name' => '<b>x</b> y']);

    expect($html)->not->toContain('<b>')
        ->and($html)->toContain('&lt;Y');
});
