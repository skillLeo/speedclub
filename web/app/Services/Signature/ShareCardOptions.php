<?php

namespace App\Services\Signature;

use App\Enums\ShareCardTemplate;

/**
 * CF-6 (client round 1 feedback, VEH-07) and R5-2e (VEH-07 2.0): what the member chose for their share card. The defaults are the stored
 * card: the cover around its focal point, every default element the build has, the dark `band` template, no own text. `theme` colours
 * the square band and both frame formats only (ShareCardTemplate::takesTheme()); the story band and the poster stay dark.
 */
final readonly class ShareCardOptions
{
    /** What a card can show besides the photo, the make and the model: the ShareCardElement values, in this order. */
    public const ELEMENTS = ['score', 'dex', 'specs', 'mods', 'username', 'qr'];

    /** R5-2e: what the default card shows; `mods` is off until the member turns it on. */
    public const DEFAULT_SHOW = ['score', 'dex', 'specs', 'username', 'qr'];

    public const ZOOM_MIN = 1.0;

    public const ZOOM_MAX = 3.0;

    /** R5-2e: the member's own line, at most this many characters after trim. */
    public const TEXT_MAX = 60;

    /**
     * @param  string|null  $photo  a media id of one of the build's public photos; null for the cover
     * @param  list<string>  $show  a subset of ELEMENTS
     * @param  string  $theme  a ShareCardTheme value
     * @param  string  $template  a ShareCardTemplate value
     * @param  float  $zoom  1 = the largest window of the photo box's aspect that fits the photo, up to 3
     * @param  float|null  $x  the window's centre in the photo, 0 to 1; null for the focal point (else 0.5)
     * @param  float|null  $y  as $x, vertically
     * @param  string|null  $text  the member's own line, trimmed, at most TEXT_MAX characters
     */
    public function __construct(
        public ?string $photo = null,
        public array $show = self::DEFAULT_SHOW,
        public string $theme = 'dark',
        public string $template = 'band',
        public float $zoom = 1.0,
        public ?float $x = null,
        public ?float $y = null,
        public ?string $text = null,
    ) {}

    public static function defaults(): self
    {
        return new self;
    }

    public function shows(string $element): bool
    {
        return in_array($element, $this->show, true);
    }

    public function templateCase(): ShareCardTemplate
    {
        return ShareCardTemplate::tryFrom($this->template) ?? ShareCardTemplate::Band;
    }

    /** The theme the drawing uses on $format: the chosen one where the template takes it, else dark. */
    public function themeFor(string $format): string
    {
        return $this->templateCase()->takesTheme($format) && $this->theme === 'light' ? 'light' : 'dark';
    }
}
