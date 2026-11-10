<?php

use App\Enums\SecurityNotice;
use App\Mail\SecurityNoticeMail;
use Illuminate\Support\Facades\File;

/**
 * M2.8 copy ruling (02_PRODUCT_SPEC §10): the feature is "Zwei-Faktor-Schutz" / "Two-factor protection" everywhere the server speaks:
 * mails, settings, errors, the public pages, the help and the privacy drafts. Brand compounds stay unhyphenated ("SPEED CLUB Konto").
 */
function twoFactorCopyFiles(): array
{
    return [
        ...File::glob(lang_path('de/*.php')),
        ...File::glob(lang_path('en/*.php')),
        lang_path('de.json'),
        ...File::glob(database_path('data/legal/*.md')),
        ...File::glob(database_path('data/help/*.md')),
    ];
}

it('never names the feature "Zwei-Faktor-Anmeldung" or "two-factor sign-in/authentication"', function () {
    $offenders = [];

    foreach (twoFactorCopyFiles() as $file) {
        foreach (preg_split('/\R/u', File::get($file)) ?: [] as $number => $line) {
            if (preg_match('/Zwei-Faktor-(Anmeldung|Authentifizierung)|two-factor (sign-in|authentication)|SPEED CLUB-Konto/iu', $line) === 1) {
                $offenders[] = basename(dirname($file)).'/'.basename($file).':'.($number + 1);
            }
        }
    }

    expect($offenders)->toBe([]);
});

it('uses the ruled name in the two-factor mail', function (string $locale, string $subject, string $intro) {
    $mail = (new SecurityNoticeMail(SecurityNotice::TwoFactorChanged, null, 'enabled'))->locale($locale);
    $html = $mail->render();

    expect($html)->toContain($intro);
    $mail->assertHasSubject($subject);
})->with([
    ['de', 'Zwei-Faktor-Schutz geändert', 'Der Zwei-Faktor-Schutz deines Kontos ist jetzt eingeschaltet.'],
    ['en', 'Two-factor protection changed', 'Two-factor protection is now on for your account.'],
]);

it('uses the ruled name in the help article and the settings errors', function () {
    expect(File::get(database_path('data/help/two-factor.de.md')))->toContain('title: Zwei-Faktor-Schutz')
        ->and(File::get(database_path('data/help/two-factor.en.md')))->toContain('title: Two-factor protection')
        ->and(__('settings.two_factor.already_on', [], 'de'))->toBe('Der Zwei-Faktor-Schutz ist schon eingeschaltet.')
        ->and(__('settings.two_factor.already_on', [], 'en'))->toBe('Two-factor protection is already on.');
});
