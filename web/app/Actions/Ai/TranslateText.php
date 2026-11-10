<?php

namespace App\Actions\Ai;

use App\Enums\AiFeature;
use App\Enums\ErrorCode;
use App\Enums\MessageType;
use App\Enums\TranslationSource;
use App\Exceptions\ApiException;
use App\Models\AiTranslation;
use App\Models\BuildUpdate;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Ai\Agents\TranslateAgent;
use App\Services\Ai\AiFailed;
use App\Services\Ai\AiGateway;
use App\Services\Ai\Numbers;
use App\Services\Messaging\Conversations;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * POST ai/translate (ai.translate; an explicit tap, no opt-in setting): a vehicle description (VEH-01), a build update note or a message
 * (MSG-02) into de or en, labelled "Übersetzt" with "Original anzeigen" in the app. Access is the source's own: the member must be able to
 * read it (VehiclePolicy, BuildUpdatePolicy; a message only for a participant of its conversation, MessagePolicy); otherwise 404, so
 * nobody learns whether an id exists. Cached per source, language and the hash of the source text for 30 days (AiTranslation, encrypted),
 * so an edit is translated anew and a cache hit costs no call. A translation that changes a number is unverifiable.
 *
 * @throws AiFailed|ApiException|ValidationException
 */
class TranslateText
{
    public const MAX_SOURCE = 4000;

    public function __construct(private readonly AiGateway $gateway, private readonly Conversations $conversations) {}

    /**
     * @return array{text: string, cached: bool}
     */
    public function handle(User $member, TranslationSource $source, string $id, string $to): array
    {
        $this->gateway->ensureMayUse(AiFeature::Translate, $member);

        $text = trim($this->sourceText($member, $source, strtolower($id)));

        if ($text === '') {
            throw ValidationException::withMessages(['id' => [(string) __('ai.nothing_to_translate')]]);
        }

        if (mb_strlen($text) > self::MAX_SOURCE) {
            throw ValidationException::withMessages(['id' => [(string) __('ai.too_long_to_translate')]]);
        }

        $hash = hash('sha256', $to.'|'.$text);
        $cached = AiTranslation::query()->where([
            'source_type' => $source->value, 'source_id' => strtolower($id), 'to' => $to, 'source_hash' => $hash,
        ])->where('expires_at', '>', now())->first();

        if ($cached !== null) {
            return ['text' => $cached->text, 'cached' => true];
        }

        $prompt = 'Target language: '.($to === 'en' ? 'English' : 'German')."\nText:\n".$text;
        $answer = $this->gateway->ask(AiFeature::Translate, new TranslateAgent, $prompt, member: $member);
        $translated = trim((string) $answer->string('text'));

        if ($translated === '' || mb_strlen($translated) > self::MAX_SOURCE || ! Numbers::allFrom($translated, $text)) {
            $this->gateway->reject($answer);
        }

        try {
            $row = new AiTranslation;
            $row->forceFill([
                'source_type' => $source, 'source_id' => strtolower($id), 'to' => $to, 'source_hash' => $hash, 'text' => $translated,
                'expires_at' => now()->addDays(config()->integer('speedclub.ai.translation_cache_days')),
            ])->save();
        } catch (UniqueConstraintViolationException) {
            // A parallel tap stored the same translation first (an expired row is replaced by the prune).
        }

        return ['text' => $translated, 'cached' => false];
    }

    /**
     * SEC-P3-16: only what the member's thread (MSG-02) still shows: not a message before their "delete for me" point, nor one they hid.
     */
    private function stillShown(User $member, Message $message): bool
    {
        $participant = ConversationParticipant::query()->where('conversation_id', $message->conversation_id)->where('user_id', $member->id)->first();

        return $participant !== null && $this->conversations->visibleFor(DB::table('messages as m')->where('m.id', $message->id), 'm', null, $participant)->exists();
    }

    /**
     * @throws ApiException 404 when the member may not read the source
     */
    private function sourceText(User $member, TranslationSource $source, string $id): string
    {
        $text = match ($source) {
            TranslationSource::VehicleDescription => ($vehicle = Vehicle::query()->find($id)) !== null && Gate::forUser($member)->allows('view', $vehicle)
                ? $vehicle->getAttribute('description') : false,
            TranslationSource::BuildUpdate => ($update = BuildUpdate::query()->with('vehicle')->find($id)) !== null && Gate::forUser($member)->allows('view', $update)
                ? $update->getAttribute('note') : false,
            TranslationSource::Message => ($message = Message::query()->find($id)) !== null && in_array($message->type, [MessageType::Text, MessageType::Photo], true) && Gate::forUser($member)->allows('view', $message)
                && $this->stillShown($member, $message)
                ? $message->getAttribute('body') : false,
        };

        if ($text === false) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return is_string($text) ? $text : '';
    }
}
