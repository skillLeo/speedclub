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
 *
 * Event maps (ADR-449): the MapLibre GL controller loads its library and stylesheet (SEC-414-04: self-hosted under
 * /lib/maplibre-gl/{version}/, same files and SRI as the npm package), runs its worker from blob: URLs and draws OpenFreeMap tiles.
 * The map only loads after a tap, so the tile host sees no request on page load. Only /app carries these sources; Blade and the API
 * keep their own presets. No source is a bare third-party origin: a host source would allow every file of that host (unpkg serves
 * any npm package), so a third-party script or stylesheet is named by its exact file only.
 */
class SpaPreset implements Preset
{
    /** The pinned MapLibre GL version (mobile/src/features/events/map/mapConfig.ts MAPLIBRE_VERSION). */
    public const MAP_LIBRARY_VERSION = '4.7.1';

    /** Where the library and its stylesheet are served from this origin ('self'). */
    public const MAP_LIBRARY_PATH = '/lib/maplibre-gl/'.self::MAP_LIBRARY_VERSION;

    /** The subresource integrity of the served files (identical to the npm package's, as in mapConfig.ts). */
    public const MAP_LIBRARY_SRI = [
        'maplibre-gl.js' => 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj',
        'maplibre-gl.css' => 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V',
    ];

    /**
     * Transitional (SEC-414-04): the exact unpkg files the member web loaded before it switched to MAP_LIBRARY_PATH, so the export
     * that is live keeps its map until the next /app export. Exact files only (never the host). Remove once mapConfig.ts points at
     * /lib and /app is exported again.
     *
     * @var array{script: list<string>, style: list<string>}
     */
    public const MAP_LIBRARY_LEGACY = [
        'script' => ['https://unpkg.com/maplibre-gl@'.self::MAP_LIBRARY_VERSION.'/dist/maplibre-gl.js'],
        'style' => ['https://unpkg.com/maplibre-gl@'.self::MAP_LIBRARY_VERSION.'/dist/maplibre-gl.css'],
    ];

    /** Vector tiles, glyphs and sprites of the event map. */
    public const MAP_TILES_HOST = 'https://tiles.openfreemap.org';

    public function configure(Policy $policy): void
    {
        $inline = $this->inlineHashes();

        $policy
            ->add(Directive::DEFAULT, Keyword::SELF)
            ->add(Directive::BASE, Keyword::SELF)
            ->add(Directive::FORM_ACTION, Keyword::SELF)
            ->add(Directive::FRAME_ANCESTORS, Keyword::NONE)
            ->add(Directive::OBJECT, Keyword::NONE)
            ->add(Directive::SCRIPT, [Keyword::SELF, ...$inline['script'], ...self::MAP_LIBRARY_LEGACY['script']])
            ->add(Directive::STYLE, [Keyword::SELF, Keyword::UNSAFE_INLINE, ...self::MAP_LIBRARY_LEGACY['style']])
            ->add(Directive::WORKER, [Keyword::SELF, 'blob:'])
            ->add(Directive::CHILD, [Keyword::SELF, 'blob:'])
            ->add(Directive::FONT, [Keyword::SELF, 'data:'])
            ->add(Directive::IMG, [Keyword::SELF, 'data:', 'blob:', ...MediaSources::hosts(), self::MAP_TILES_HOST])
            ->add(Directive::MEDIA, [Keyword::SELF, 'blob:', ...MediaSources::hosts()])
            ->add(Directive::CONNECT, [Keyword::SELF, ...Realtime::connectHosts(), self::MAP_TILES_HOST]);
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
