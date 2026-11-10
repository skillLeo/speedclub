<?php

namespace App\Http\Csp;

use App\Services\Messaging\Realtime;
use Spatie\Csp\Directive;
use Spatie\Csp\Keyword;
use Spatie\Csp\Policy;
use Spatie\Csp\Preset;

/**
 * The Expo export in /app is a static file and cannot carry nonces: its inline script and styles are allowed by hash,
 * computed from the file actually served, so a new export can never drift from the policy.
 *
 * react-native-web injects its generated stylesheet at runtime, which no hash can cover, so style-src-elem has to
 * allow inline styles. Scripts stay without any unsafe keyword.
 */
class SpaPreset implements Preset
{
    public function configure(Policy $policy): void
    {
        $inline = $this->inlineHashes();

        $policy
            ->add(Directive::DEFAULT, Keyword::SELF)
            ->add(Directive::BASE, Keyword::SELF)
            ->add(Directive::FORM_ACTION, Keyword::SELF)
            ->add(Directive::FRAME_ANCESTORS, Keyword::NONE)
            ->add(Directive::OBJECT, Keyword::NONE)
            ->add(Directive::SCRIPT, [Keyword::SELF, ...$inline['script']])
            ->add(Directive::STYLE, [Keyword::SELF, Keyword::UNSAFE_INLINE])
            ->add(Directive::FONT, [Keyword::SELF, 'data:'])
            ->add(Directive::IMG, [Keyword::SELF, 'data:', 'blob:', ...MediaSources::hosts()])
            ->add(Directive::MEDIA, [Keyword::SELF, 'blob:', ...MediaSources::hosts()])
            ->add(Directive::CONNECT, [Keyword::SELF, ...Realtime::connectHosts()]);
    }

    /**
     * @return array{script: list<string>}
     */
    private function inlineHashes(): array
    {
        $index = config()->string('speedclub.spa.index');
        $html = is_file($index) ? (string) file_get_contents($index) : '';

        return ['script' => $this->hashesOf($html)];
    }

    /**
     * Inline scripts only: <script src> is covered by 'self'. The HTML parser turns CRLF into LF before the browser
     * hashes, so the text is normalised the same way.
     *
     * @return list<string>
     */
    private function hashesOf(string $html): array
    {
        preg_match_all('/<script\b([^>]*)>(.*?)<\/script\s*>/is', $html, $matches, PREG_SET_ORDER);

        $hashes = [];

        foreach ($matches as $match) {
            if (preg_match('/\bsrc\s*=/i', $match[1]) === 1) {
                continue;
            }

            $text = str_replace(["\r\n", "\r"], "\n", $match[2]);
            $hashes[] = 'sha256-'.base64_encode(hash('sha256', $text, true));
        }

        return array_values(array_unique($hashes));
    }
}
