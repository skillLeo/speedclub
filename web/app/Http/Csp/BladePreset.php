<?php

namespace App\Http\Csp;

use App\Services\Support\Turnstile;
use Spatie\Csp\Directive;
use Spatie\Csp\Keyword;
use Spatie\Csp\Policy;
use Spatie\Csp\Preset;

/**
 * Public Blade pages and the Inertia admin: every inline script or style carries the request's nonce.
 */
class BladePreset implements Preset
{
    /**
     * Before every screenshot in WebKit, Playwright appends `<style>body {}</style>` and removes it at once, to resync CSS
     * animations (its screenshotter's inPagePrepareForScreenshots). It cannot carry our nonce, so WebKit refused it and logged
     * "Refused to apply a stylesheet …" on every capture of a Blade page; Chromium takes screenshots without that tag. The
     * hash allows exactly this empty rule, which styles nothing, and nothing else. Outside production only, as the QA
     * overrides the screenshots run with.
     */
    public const SCREENSHOT_SYNC_STYLE = 'body {}';

    /**
     * WebKit (27.x, Safari's engine) writes this style attribute into the user-agent shadow tree of every <select> and checks it
     * against the page's style-src-attr, as if an author had written it, so any page with a native select (WEB-09 /melden,
     * WEB-10 /kontakt) logged "Refused to apply a stylesheet …" and lost the rule. Found with the securitypolicyviolation
     * event's sample on a page holding nothing but `<select></select>`. 'unsafe-hashes' with this single hash allows exactly
     * this declaration in a style attribute and no other: every author style attribute stays refused, as before, and style
     * elements still need the nonce. In every environment, because Safari visitors meet it in production.
     */
    public const WEBKIT_SELECT_STYLE_ATTR = 'text-overflow:inherit';

    public function configure(Policy $policy): void
    {
        $policy
            ->add(Directive::DEFAULT, Keyword::SELF)
            ->add(Directive::BASE, Keyword::SELF)
            ->add(Directive::FORM_ACTION, Keyword::SELF)
            ->add(Directive::FRAME_ANCESTORS, Keyword::NONE)
            ->add(Directive::OBJECT, Keyword::NONE)
            ->add(Directive::SCRIPT, Keyword::SELF)
            ->add(Directive::STYLE, Keyword::SELF)
            ->add(Directive::FONT, [Keyword::SELF, 'data:'])
            ->add(Directive::IMG, [Keyword::SELF, 'data:', 'blob:', ...MediaSources::hosts()])
            ->add(Directive::CONNECT, Keyword::SELF)
            ->addNonce(Directive::SCRIPT)
            ->addNonce(Directive::STYLE)
            ->add(Directive::STYLE_ATTR, [Keyword::UNSAFE_HASHES, self::hash(self::WEBKIT_SELECT_STYLE_ATTR)]);

        // WEB-05, WEB-09, WEB-10: the Turnstile widget loads its script and frame from Cloudflare, only when it is configured (M2.5).
        if (Turnstile::enabled()) {
            $policy
                ->add(Directive::SCRIPT, 'https://challenges.cloudflare.com')
                ->add(Directive::FRAME, 'https://challenges.cloudflare.com')
                ->add(Directive::CONNECT, 'https://challenges.cloudflare.com');
        }

        if (! app()->isProduction()) {
            $policy->add(Directive::STYLE, self::hash(self::SCREENSHOT_SYNC_STYLE));
        }
    }

    /** A CSP source for exactly this text. */
    public static function hash(string $text): string
    {
        return 'sha256-'.base64_encode(hash('sha256', $text, true));
    }
}
