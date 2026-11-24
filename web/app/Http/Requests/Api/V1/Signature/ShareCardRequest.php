<?php

namespace App\Http\Requests\Api\V1\Signature;

use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Enums\KeywordList;
use App\Enums\ShareCardElement;
use App\Enums\ShareCardTemplate;
use App\Enums\ShareCardTheme;
use App\Exceptions\ApiException;
use App\Services\Rules\KeywordRules;
use App\Services\Signature\ShareCardOptions;
use App\Services\Signature\ShareCards;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ShareCardRequest extends FormRequest
{
    /**
     * R5-2e: the characters the card fonts draw for the own line: Basic Latin, Latin-1 and Latin Extended-A (printable), and
     * `–—„“”‚‘’…·•`. No emoji, no control characters, no line breaks.
     */
    public const TEXT_PATTERN = '/^[\x{0020}-\x{007E}\x{00A0}-\x{017F}\x{2013}\x{2014}\x{201E}\x{201C}\x{201D}\x{201A}\x{2018}\x{2019}\x{2026}\x{2022}]*$/u';

    /**
     * `show` comes bracketed (`show[]=score&show[]=qr`) or comma-separated (`show=score,qr`); an empty `show=` shows none of them.
     */
    protected function prepareForValidation(): void
    {
        if (! $this->has('show')) {
            return;
        }

        $show = $this->input('show');

        if (is_string($show)) {
            $show = explode(',', $show);
        }

        $this->merge(['show' => is_array($show) ? array_values(array_filter(array_map(fn (mixed $value): mixed => is_string($value) ? trim($value) : $value, $show), fn (mixed $value): bool => $value !== null && $value !== '')) : ($show === null ? [] : $show)]);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** `story` 1080 × 1920 (default) or `square` 1080 × 1080. */
            'format' => ['sometimes', 'string', Rule::in(ShareCards::formats())],
            /**
             * R5-2e: the layout. `band` (default) = the card as before (square: photo on top, band below; story: photo edge to edge, data
             * at the bottom); `poster` = the photo edge to edge on both formats under a dark scrim, the name large at the top of the safe
             * area, data and QR at the bottom, always dark; `frame` = the photo inset on a solid ground with a caption block, takes `theme`.
             */
            'template' => ['sometimes', 'string', Rule::enum(ShareCardTemplate::class)],
            /**
             * CF-6: the media id of one of the build's photos that everybody may see (ready, not rejected); default the cover. Any other
             * id answers 422 on `photo`, without saying whether it exists.
             */
            'photo' => ['sometimes', 'string', 'max:64'],
            /**
             * R5-2e crop: 1.00 (default) to 3.00, at most two decimals. 1 = the largest window of the template's photo box aspect that
             * fits the photo (photo boxes: band 1080 × 600 square / 1080 × 1920 story, poster 1080 × 1080 / 1080 × 1920, frame
             * 984 × 600 / 984 × 1080).
             */
            'zoom' => ['sometimes', 'numeric', 'decimal:0,2', 'between:'.ShareCardOptions::ZOOM_MIN.','.ShareCardOptions::ZOOM_MAX],
            /**
             * R5-2e crop: the horizontal centre of the window in the photo, 0 to 1; default the photo's focal point, else 0.5. The server
             * clamps the window inside the photo (never letterboxes).
             */
            'x' => ['sometimes', 'numeric', 'between:0,1'],
            /** R5-2e crop: the vertical centre of the window in the photo, 0 to 1; default the focal point, else 0.5. Clamped as `x`. */
            'y' => ['sometimes', 'numeric', 'between:0,1'],
            'show' => ['sometimes', 'array', 'max:'.count(ShareCardOptions::ELEMENTS)],
            /**
             * CF-6 / R5-2e: what the card shows besides the photo, the make and the model, a subset of `score`, `dex`, `specs`, `mods`,
             * `username`, `qr` (default: `score,dex,specs,username,qr`, what the build has). Bracketed (`show[]=score&show[]=qr`) or
             * comma-separated (`show=score,qr`); an empty `show=` shows none. `mods` (off by default) = "12 Mods" and up to two of the
             * build's installed mods that fit on the line. Without `qr` the card carries no code. `username` still needs the owner to
             * show themselves (ADR-148 a).
             */
            'show.*' => ['string', 'distinct', Rule::enum(ShareCardElement::class)],
            /** CF-6 / R5-2e: `dark` (default) or `light`, for the square `band` and both `frame` formats; ignored elsewhere. */
            'theme' => ['sometimes', 'string', Rule::enum(ShareCardTheme::class)],
            /**
             * R5-2e: the member's own line, at most 60 characters after trim, one line. Letters, digits, spaces and common punctuation
             * (Latin, Latin-1, Latin Extended-A, `–—„“”‚‘’…·•`); anything else (emoji, control characters, line breaks) answers 422 on
             * `text`. A term of the keyword block list answers 422 `content_blocked` on `text`.
             */
            'text' => ['sometimes', 'nullable', 'string', 'max:'.ShareCardOptions::TEXT_MAX, 'regex:'.self::TEXT_PATTERN],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'text.regex' => (string) __('signature.share_card.text_characters'),
            'text.max' => (string) __('signature.share_card.text_length', ['max' => ShareCardOptions::TEXT_MAX]),
            'text.string' => (string) __('signature.share_card.text_characters'),
        ];
    }

    /**
     * R5-2e: the own line against the keyword block list (ADM-23), with the rules' neutral message on the field; a hit counts for the rule.
     *
     * @throws ApiException 422 content_blocked
     */
    protected function passedValidation(): void
    {
        $text = $this->validated('text');

        if (! is_string($text)) {
            return;
        }

        $rules = app(KeywordRules::class);
        $hits = $rules->match($text, KeywordList::Block);

        if ($hits !== []) {
            // ADM-23 "Treffer 30 Tage": per rule and field, never the member or the text.
            $rules->count($hits, KeywordField::ShareCardText);

            throw new ApiException(ErrorCode::ContentBlocked, errors: ['text' => [(string) __('errors.content_blocked_field')]]);
        }
    }

    public function cardFormat(): string
    {
        return $this->string('format', 'story')->toString();
    }

    public function cardOptions(): ShareCardOptions
    {
        $validated = $this->validated();
        $show = $validated['show'] ?? null;
        $text = isset($validated['text']) && is_string($validated['text']) ? trim($validated['text']) : '';

        return new ShareCardOptions(
            photo: isset($validated['photo']) ? (string) $validated['photo'] : null,
            show: is_array($show) ? array_values(array_intersect(ShareCardOptions::ELEMENTS, $show)) : ShareCardOptions::DEFAULT_SHOW,
            theme: (string) ($validated['theme'] ?? 'dark'),
            template: (string) ($validated['template'] ?? 'band'),
            zoom: round((float) ($validated['zoom'] ?? 1), 2),
            // Four decimals are far below a pixel and keep the cache key short.
            x: isset($validated['x']) ? round((float) $validated['x'], 4) : null,
            y: isset($validated['y']) ? round((float) $validated['y'], 4) : null,
            text: $text === '' ? null : $text,
        );
    }
}
