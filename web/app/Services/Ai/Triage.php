<?php

namespace App\Services\Ai;

use App\Enums\AiFeature;
use App\Enums\CaseOrigin;
use App\Enums\ReportTargetType;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Report;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Ai\Agents\TriageAgent;
use Illuminate\Support\Str;
use Laravel\Ai\Files\Image;
use Laravel\Ai\Files\StoredImage;

/**
 * ai.moderation_triage (02 §6, m3.7 contract §1): a risk score 0–100 and a German reason (≤ 140 characters) for a new report case and a
 * new public photo, stored as ai_score (risk_score / 100) and ai_summary on moderation_cases and media and shown to staff as
 * "KI-Vorschlag". It writes nothing else: no status, no priority, no decision; a human decides.
 *
 * What the prompt carries: the target type, the report reasons with their counts, and for anything but a message the reporters' details
 * and the target's public text (both cut to speedclub.ai.triage_text_chars); a photo as its 640 px variant. Never a message's content,
 * never an address or a name of a reporter.
 *
 * Detection (DSA Art. 17(3)(c)): a staff case opened on a photo the triage had scored at least speedclub.ai.detection_score before is
 * marked ai_detected (markDetection(), from the case's creating event), so its statement of reasons can say automated means found it.
 */
final class Triage
{
    public function __construct(private readonly AiGateway $gateway) {}

    public function enabled(): bool
    {
        return $this->gateway->enabled(AiFeature::ModerationTriage);
    }

    /** @return bool whether a score was stored */
    public function scoreCase(ModerationCase $case): bool
    {
        if (! $this->enabled() || ! $case->status->isOpen()) {
            return false;
        }

        $attachments = [];

        if ($case->target_type === ReportTargetType::Photo) {
            $photo = Media::query()->find($case->target_id);
            $image = $photo === null ? null : self::image($photo);
            $attachments = $image === null ? [] : [$image];
        }

        try {
            $answer = $this->gateway->ask(AiFeature::ModerationTriage, new TriageAgent, $this->casePrompt($case), $attachments);
        } catch (AiFailed) {
            return false;
        }

        [$score, $reason] = $this->result($answer) ?? [null, null];

        if ($score === null) {
            return false;
        }

        ModerationCase::query()->whereKey($case->id)->toBase()->update(['ai_score' => $score / 100, 'ai_summary' => $reason, 'ai_scored_at' => now()]);

        return true;
    }

    /** @return bool whether a score was stored */
    public function scoreMedia(Media $photo): bool
    {
        $image = self::image($photo);

        if (! $this->enabled() || $image === null) {
            return false;
        }

        try {
            $answer = $this->gateway->ask(AiFeature::ModerationTriage, new TriageAgent, 'A member uploaded this photo to a public build page. Rate it.', [$image]);
        } catch (AiFailed) {
            return false;
        }

        [$score, $reason] = $this->result($answer) ?? [null, null];

        if ($score === null) {
            return false;
        }

        Media::query()->whereKey($photo->id)->toBase()->update(['ai_score' => $score / 100, 'ai_summary' => $reason, 'ai_scored_at' => now()]);

        return true;
    }

    /**
     * Before a staff case on a photo is stored: did the triage flag that photo before anybody opened it?
     */
    public static function markDetection(ModerationCase $case): void
    {
        if ($case->origin !== CaseOrigin::Staff || $case->target_type !== ReportTargetType::Photo) {
            return;
        }

        $score = Media::withTrashed()->whereKey($case->target_id)->value('ai_score');

        if ($score !== null && (float) $score * 100 >= config()->integer('speedclub.ai.detection_score')) {
            $case->setAttribute('ai_detected', true);
        }
    }

    /**
     * @return array{0: int, 1: string}|null
     */
    private function result(AiAnswer $answer): ?array
    {
        $score = $answer->data['risk_score'] ?? null;
        $reason = trim((string) $answer->string('risk_reason'));

        if (! is_int($score) || $score < 0 || $score > 100 || $reason === '') {
            $this->gateway->markInvalid($answer);

            return null;
        }

        return [$score, Str::limit($reason, 140, '')];
    }

    private function casePrompt(ModerationCase $case): string
    {
        $limit = config()->integer('speedclub.ai.triage_text_chars');
        $reports = Report::query()->where('case_id', $case->id)->latest('created_at')->limit(20)->get(['reason', 'sub_reason', 'details', 'source']);
        $message = $case->target_type === ReportTargetType::Message;

        $lines = ['Reported item: '.$case->target_type->value, 'Reports: '.$case->report_count];

        foreach ($reports->countBy(fn (Report $report): string => $report->reason->value.($report->sub_reason === null ? '' : '/'.$report->sub_reason->value)) as $reason => $count) {
            $lines[] = "- reason $reason: $count";
        }

        if (! $message) {
            foreach ($reports->pluck('details')->filter(fn (mixed $details): bool => is_string($details) && trim($details) !== '')->take(5) as $details) {
                $lines[] = 'Reporter wrote: '.Str::limit(trim((string) $details), $limit);
            }

            $public = $this->publicText($case);

            if ($public !== null) {
                $lines[] = 'Public text of the item: '.Str::limit($public, $limit);
            }
        } else {
            $lines[] = 'The item is a private message; its content is not shared with you. Rate from the reasons only.';
        }

        return implode("\n", $lines);
    }

    private function publicText(ModerationCase $case): ?string
    {
        $text = match ($case->target_type) {
            ReportTargetType::Vehicle => Vehicle::query()->whereKey($case->target_id)->value('description'),
            ReportTargetType::BuildUpdate => BuildUpdate::query()->whereKey($case->target_id)->value('note'),
            ReportTargetType::Modification => Modification::query()->whereKey($case->target_id)->value('notes'),
            ReportTargetType::Member => User::query()->whereKey($case->target_id)->value('bio'),
            default => null,
        };

        return is_string($text) && trim($text) !== '' ? trim($text) : null;
    }

    private static function image(Media $photo): ?StoredImage
    {
        $variants = $photo->getAttribute('variants');
        $path = is_array($variants) ? ($variants['640'] ?? null) : null;

        return is_string($path) ? Image::fromStorage($path, (string) $photo->getAttribute('disk')) : null;
    }
}
