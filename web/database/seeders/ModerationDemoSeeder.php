<?php

namespace Database\Seeders;

use App\Actions\Admin\Support\AddTicketNote;
use App\Actions\Admin\Support\ReplyToTicket;
use App\Actions\Messaging\AnswerRequest;
use App\Actions\Messaging\SendMessage;
use App\Actions\Messaging\StartConversation;
use App\Actions\Moderation\DecideCase;
use App\Actions\Moderation\FileAppeal;
use App\Actions\Moderation\SubmitReport;
use App\Actions\Support\CreateSupportTicket;
use App\Enums\DecisionAction;
use App\Enums\DecisionViewer;
use App\Enums\GroundDocument;
use App\Enums\IllegalSubReason;
use App\Enums\KeywordField;
use App\Enums\KeywordList;
use App\Enums\MessageType;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Enums\SupportCategory;
use App\Enums\SupportTicketStatus;
use App\Models\BuildUpdate;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Decision;
use App\Models\KeywordRule;
use App\Models\Media;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Notification;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\ReportDraft;
use App\Services\Moderation\ReportTargets;
use App\Services\Rules\KeywordFlagger;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use Carbon\CarbonImmutable;
use Closure;
use Database\Seeders\Concerns\SeedClock;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use LogicException;
use Symfony\Component\Uid\Ulid;
use Throwable;

/**
 * M2.6 demo (m2.6-contract §4), called by DemoSeeder at the end, through the real Actions at fixed moments before NOW:
 *
 * - **decided:** nico.sti reported the second photo of tobi.quattro's Audi RS6 (C8), a catalogue shot of a wheel, as a copyright matter;
 *   staff removed it with a statement of reasons. tobi.quattro sees SAFE-01 (affected) and SET-16 "Entscheidungen", nico.sti the
 *   outcome. Neither builds nor members of a flagship screen are touched, and the cover stays (the first photo).
 * - **open:** lukas.sc reported nico.sti's Toyota GR Yaris; the case is new, so his SET-16 "Meine Meldungen" shows "Eingegangen".
 *
 * lukas.sc gets no notification from this (his HOME-02 history stays as M2.2 seeded it). Without demo photos the decided case is left out.
 * The decision has a fixed id (decisionId(), like DemoSeeder's conversations), so e2e and the visual matrix can address
 * /app/decisions/{id} without asking the API first.
 */
class ModerationDemoSeeder extends Seeder
{
    /**
     * The id of the seeded decision about tobi.quattro's RS6 photo: a ULID of the moment it was decided, the same on every machine
     * for the same NOW (locally always DemoSeeder::NOW).
     */
    public static function decisionId(CarbonImmutable $now): string
    {
        return DemoSeeder::demoUlid(self::decidedAt($now), 'decision:audi-rs6-c8:photo-2');
    }

    private static function decidedAt(CarbonImmutable $now): CarbonImmutable
    {
        return $now->subDays(7)->setTime(10, 15);
    }

    public function run(CarbonImmutable $now): void
    {
        // Whatever no moment below dates (a mailed_at save, a rule) is dated $now, never the wall clock (DQ-677).
        SeedClock::at($now, fn () => $this->seedAll($now));
    }

    private function seedAll(CarbonImmutable $now): void
    {
        $targets = app(ReportTargets::class);
        $submit = app(SubmitReport::class);
        $nico = User::query()->where('username', 'nico.sti')->firstOrFail();
        $lukas = User::query()->where('username', 'lukas.sc')->firstOrFail();
        $rs6 = Vehicle::query()->where('public_id', DemoSeeder::publicIdFor('audi-rs6-c8'))->firstOrFail();
        $yaris = Vehicle::query()->where('public_id', DemoSeeder::publicIdFor('toyota-gr-yaris'))->firstOrFail();
        $photo = Media::query()
            ->where('mediable_type', $rs6->getMorphClass())
            ->where('mediable_id', $rs6->id)
            ->whereKeyNot((string) $rs6->getAttribute('cover_media_id'))
            ->usablePhoto()
            ->orderBy('sort')
            ->first();

        if ($photo instanceof Media) {
            $this->at($now->subDays(9)->setTime(19, 40), fn () => $this->withFixedId(self::fixedId('rs6-photo-case', $now), fn () => $submit->handle(
                $targets->forMember($nico, ReportTargetType::Photo, $photo->id),
                new ReportDraft(
                    source: ReportSource::App,
                    reporter: $nico,
                    reason: ReportReason::Illegal,
                    subReason: IllegalSubReason::Copyright,
                    details: 'Das Felgenfoto ist ein Produktbild aus einem Shop-Katalog, nicht vom eigenen Auto.',
                    goodFaith: true,
                ),
            )));

            $this->at(self::decidedAt($now), function () use ($photo, $now): void {
                $case = ModerationCase::query()->where('target_type', ReportTargetType::Photo->value)->where('target_id', $photo->id)->firstOrFail();

                // The decision is the first row DecideCase gives a ULID; only that one id is fixed, every later one is random again.
                $id = self::decisionId($now);
                Str::createUlidsUsing(function () use ($id): Ulid {
                    Str::createUlidsNormally();

                    return Ulid::fromString($id);
                });

                try {
                    $decision = app(DecideCase::class)->handle($case, new DecisionInput(
                        action: DecisionAction::RemoveContent,
                        facts: 'Das zweite Foto deines Builds ist ein Produktbild aus einem Shop-Katalog. Dass du es verwenden darfst, war nicht ersichtlich.',
                        ground: "Community-Richtlinien §\u{00A0}4 (Deine Inhalte): nur Fotos, an denen du die Rechte hast",
                        groundDocument: GroundDocument::Community,
                        groundSection: '4',
                        reason: 'Demodaten (DemoSeeder)',
                    ));
                } finally {
                    Str::createUlidsNormally();
                }

                if ($decision->id !== $id) {
                    throw new LogicException('The demo decision did not get its fixed id; DecideCase now makes another ULID first.');
                }
            });
        } else {
            $this->command?->warn('Demo moderation: no second photo on the RS6, so no decided case was seeded.');
        }

        // A fixed case id, as every case of the queue below has: ADM-20 prints its reference (the id's last eight characters, DQ-698).
        $this->at($now->subDays(2)->setTime(21, 5), fn () => $this->withFixedId(self::fixedId('yaris-case', $now), fn () => $submit->handle(
            $targets->forMember($lukas, ReportTargetType::Vehicle, $yaris->id),
            new ReportDraft(
                source: ReportSource::App,
                reporter: $lukas,
                reason: ReportReason::Other,
                details: 'Ich glaube, die Angaben zu den Felgen stimmen nicht mit dem Foto überein.',
            ),
        )));

        $this->seedAdminQueue($now);
    }

    /**
     * M3.4 (ADM-20…27): what the admin's moderation and support screens need to be reviewable, through the real Actions at fixed moments
     * before NOW, touching no member of a flagship screen (lukas.sc, tobi.quattro, nico.sti stay as they are):
     *
     * - a harassment conversation: aylin.vtec reports a message of marco.amg with its context (ADM-22, open);
     * - finn.jdm reported marco.amg's profile; the system restricted his messaging, and marco.amg appealed (Einsprüche, open);
     * - a WEB-09 notice about paul.roadster's MX-5 (street racing, with the notifier's contact);
     * - an automated notice from the keyword rule "Rabattcode" about an update of aylin.vtec's FK8, and two spam notices (spam wave);
     * - keyword rules on both lists, and support tickets: a member's with a team reply and an internal note, a web contact's, a solved one.
     *
     * Idempotent: does nothing once the keyword rule "Rabattcode" exists. Callable on its own for an existing demo database.
     */
    public function seedAdminQueue(CarbonImmutable $now): void
    {
        if (KeywordRule::query()->where('normalized', 'rabattcode')->exists()) {
            return;
        }

        // All or nothing: a half-seeded queue would block the next run (the rule above is its marker).
        SeedClock::at($now, fn () => DB::transaction(fn () => $this->seedAdminRows($now)));

        // Only lukas.sc has a notification history in the demo (M2.2): the in-app rows the seeded decision wrote after the commit go.
        $members = User::query()->whereIn('username', ['marco.amg', 'finn.jdm', 'aylin.vtec'])->pluck('id');
        Notification::query()->whereIn('notifiable_id', $members)->delete();
    }

    private function seedAdminRows(CarbonImmutable $now): void
    {

        $member = fn (string $username): User => User::query()->where('username', $username)->firstOrFail();
        $vehicle = fn (string $key): Vehicle => Vehicle::query()->where('public_id', DemoSeeder::publicIdFor($key))->firstOrFail();
        $targets = app(ReportTargets::class);
        $submit = app(SubmitReport::class);
        $marco = $member('marco.amg');
        $aylin = $member('aylin.vtec');
        $finn = $member('finn.jdm');
        $paul = $member('paul.roadster');
        $lena = $member('lena.911');
        $sara = $member('sara.gti');

        foreach ([['Darknet', KeywordList::Block], ['Rabattcode', KeywordList::Flag], ['Führerschein weg', KeywordList::Flag]] as [$term, $list]) {
            $rule = new KeywordRule;
            $rule->forceFill(['term' => $term, 'normalized' => KeywordNormaliser::term($term), 'list' => $list, 'created_at' => $now->subDays(20), 'updated_at' => $now->subDays(20)])->save();
        }
        app(KeywordRules::class)->flush();

        // ADM-22: a message request that turned into insults; aylin.vtec reports the last one with its context.
        $text = fn (string $body, string $client): array => ['type' => MessageType::Text, 'body' => $body, 'media_id' => null, 'vehicle_id' => null, 'client_id' => $client];
        $day = fn (int $days, string $time): CarbonImmutable => $now->subDays($days)->setTimeFromTimeString($time);
        // A fixed id, as DemoSeeder::chat() gives its conversations; StartConversation then finds the row.
        Conversation::query()->insertOrIgnore([
            'id' => DemoSeeder::demoUlid($day(3, '20:02'), 'conversation:marco.amg-aylin.vtec'),
            'pair_key' => Conversation::pairKey($marco, $aylin),
            'created_by' => $marco->id,
            'created_at' => $day(3, '20:02'),
            'updated_at' => $day(3, '20:02'),
        ]);
        $this->at($day(3, '20:02'), fn () => app(StartConversation::class)->handle($marco, $aylin, null, $text('Na, fährst du den FK8 selbst oder nur dein Freund?', 'demo-m34-01'), null));
        $aylinSide = $this->side($aylin, $marco);
        $this->at($day(3, '20:10'), function () use ($aylin, $aylinSide): void {
            try {
                app(AnswerRequest::class)->accept($aylin, $aylinSide);
            } catch (Throwable) {
                // Not a request (they may already be connected): the reply below works either way.
            }
        });
        $this->at($day(3, '20:11'), fn () => app(SendMessage::class)->handle($aylin, $aylinSide->refresh(), $text('Den fahre ich selbst, seit drei Jahren. Was soll die Frage?', 'demo-m34-02'), null));
        $marcoSide = $this->side($marco, $aylin);
        $this->at($day(3, '20:15'), fn () => app(SendMessage::class)->handle($marco, $marcoSide, $text('Frauen und Fronttriebler, passt ja. Bleib lieber auf dem Supermarktparkplatz.', 'demo-m34-03'), null));
        $this->at($day(3, '20:16'), fn () => app(SendMessage::class)->handle($marco, $marcoSide, $text('Und lösch deine Bilder vom Ring, peinlich.', 'demo-m34-04'), null));
        $reported = Message::query()->where('sender_id', $marco->id)->where('client_id', 'demo-m34-03')->firstOrFail();
        $this->at($day(3, '20:24'), fn () => $this->withFixedId(self::fixedId('message-case', $now), fn () => $submit->handle(
            $targets->forMember($aylin, ReportTargetType::Message, $reported->id),
            new ReportDraft(source: ReportSource::App, reporter: $aylin, reason: ReportReason::Harassment, details: 'Er schreibt mir nach meiner Antwort nur noch Beleidigungen.', messageContext: true),
        )));

        // Einsprüche: finn.jdm reported marco.amg's profile; the system restricted his messaging; marco.amg appealed.
        $this->at($day(9, '18:30'), fn () => $this->withFixedId(self::fixedId('appeal-case', $now), fn () => $submit->handle(
            $targets->forMember($finn, ReportTargetType::Member, (string) $marco->username),
            new ReportDraft(source: ReportSource::App, reporter: $finn, reason: ReportReason::Harassment, details: 'Schreibt mehreren aus der JDM-Ecke abfällige Nachrichten nach Treffen.'),
        )));
        $case = ModerationCase::query()->where('target_type', ReportTargetType::Member->value)->where('target_id', $marco->id)->where('status', 'new')->firstOrFail();
        $decision = null;
        $this->at($day(8, '11:00'), function () use ($case, &$decision): void {
            $decision = app(DecideCase::class)->handle($case, new DecisionInput(
                action: DecisionAction::Restrict,
                facts: 'Du hast nach dem Treffen in Hockenheim mehreren Mitgliedern abfällige Nachrichten geschickt, auch nachdem sie dich gebeten hatten, das zu lassen.',
                ground: 'Community-Richtlinien § 2 (Respektvoller Umgang)',
                groundDocument: GroundDocument::Community,
                groundSection: '2',
                restriction: RestrictionType::Messaging,
                until: CarbonImmutable::now()->addDays(14),
                reason: 'Demodaten (DemoSeeder)',
            ));
        });
        if ($decision instanceof Decision) {
            // History, not news: no statement-of-reasons mail for the seeded decision (SendDecisionMail skips a mailed one).
            $decision->forceFill(['mailed_at' => $decision->decided_at])->save();

            $this->at($day(7, '09:40'), fn () => app(FileAppeal::class)->handle($marco, $decision, DecisionViewer::Affected, 'Das war ein Missverständnis unter Bekannten. Die Nachrichten waren als Witz gemeint, und wir haben das inzwischen geklärt.'));
        }

        // A WEB-09 notice with the notifier's contact.
        $this->at($day(1, '23:12'), fn () => $this->withFixedId(self::fixedId('web-case', $now), fn () => $submit->handle(
            $targets->forStaff($vehicle('mazda-mx5')),
            new ReportDraft(
                source: ReportSource::WebForm,
                reporter: null,
                reason: ReportReason::Illegal,
                subReason: IllegalSubReason::StreetRacing,
                details: 'Auf einem der Fotos sieht man ein Rennen auf der Landstraße bei Bremen, mit Zuschauern am Rand.',
                goodFaith: true,
                contactName: 'Jana Weber',
                contactEmail: 'jana.weber@beispiel.test',
                contactLocale: 'de',
            ),
        )));

        // The automated notice of the flag list, and a small spam wave.
        $update = BuildUpdate::query()->where('vehicle_id', $vehicle('honda-fk8')->id)->orderBy('created_at')->orderBy('id')->first();
        if ($update instanceof BuildUpdate) {
            $this->at($day(2, '07:45'), fn () => $this->withFixedId(self::fixedId('flag-case', $now), fn () => app(KeywordFlagger::class)->flag($update, [['field' => KeywordField::BuildNote, 'rules' => [['id' => 0, 'term' => 'Rabattcode', 'list' => 'flag']]]])));
        }
        foreach ([[$lena, 'vw-scirocco', '17:05'], [$sara, 'mercedes-w177', '17:20']] as [$reporter, $key, $time]) {
            $this->at($day(1, $time), fn () => $this->withFixedId(self::fixedId('spam-case:'.$key, $now), fn () => $submit->handle(
                $targets->forMember($reporter, ReportTargetType::Vehicle, $vehicle($key)->id),
                new ReportDraft(source: ReportSource::App, reporter: $reporter, reason: ReportReason::Spam, details: 'Gleicher Link zu einem Felgenshop wie bei den anderen Builds.'),
            )));
        }

        $this->seedSupport($now, $paul, $aylin);

    }

    private function seedSupport(CarbonImmutable $now, User $paul, User $aylin): void
    {
        $create = app(CreateSupportTicket::class);
        $at = fn (int $days, string $time): CarbonImmutable => $now->subDays($days)->setTimeFromTimeString($time);
        $staff = Staff::query()->where('email', 'support@speedclub.test')->first();
        // Receipt mails of the demo tickets go nowhere; the caller's mailer (a test's fake included) is restored afterwards.
        $mailer = Mail::getFacadeRoot();
        Mail::fake();

        try {
            $open = null;
            $this->at($at(2, '09:12'), function () use ($create, $aylin, $now, &$open): void {
                $open = $this->withFixedId(self::fixedId('member-ticket', $now), fn () => $create->forMember($aylin, SupportCategory::Qr, 'QR-Sticker zeigt das falsche Auto', 'Hallo, wenn man meinen Sticker scannt, öffnet sich mein altes Auto (den S2000 statt den FK8). Kann ich den Code umziehen?'));
            });
            if ($open instanceof SupportTicket && $staff instanceof Staff) {
                $this->at($at(1, '10:30'), fn () => app(AddTicketNote::class)->handle($staff, $open, 'QR hängt noch am S2000. Umziehen geht nicht, nur neu ausgeben. Prüfen, ob der Sticker schon verklebt ist.'));
                $this->at($at(1, '10:42'), fn () => app(ReplyToTicket::class)->handle($staff, $open, "Hallo Aylin,\n\nein Code gehört fest zu einem Fahrzeug. Für den FK8 gibst du in der App unter Garage → Civic Type R → QR-Code einen neuen aus. Der Sticker am S2000 funktioniert danach nicht mehr.\n\nViele Grüße\nSupport-Team"));
            }

            $this->at($at(1, '19:55'), fn () => $this->withFixedId(self::fixedId('guest-ticket', $now), fn () => $create->forGuest('Thomas Berger', 'thomas.berger@beispiel.test', SupportCategory::Account, 'Ich habe mein Konto vor zwei Wochen gelöscht, bekomme aber noch E-Mails über neue Follower. Bitte stoppt das.', 'de')));
            // Every ticket has a fixed id: ADM-25 prints its reference (SC- and the id's last eight characters, DQ-701).
            $this->at($at(0, '08:05'), fn () => $this->withFixedId(self::fixedId('guest-ticket:mira', $now), fn () => $create->forGuest('Mira Schulz', 'mira.schulz@beispiel.test', SupportCategory::Other, 'Kann man bei euch auch Treffen anlegen? Ich organisiere jeden Monat einen Stammtisch in Leipzig.', 'de')));

            $closed = null;
            $this->at($at(6, '14:20'), function () use ($create, $paul, $now, &$closed): void {
                $closed = $this->withFixedId(self::fixedId('member-ticket:paul', $now), fn () => $create->forMember($paul, SupportCategory::Vehicle, 'Baujahr lässt sich nicht ändern', 'Beim MX-5 steht 1990, er ist aber von 1991. Das Feld ist ausgegraut.'));
            });
            if ($closed instanceof SupportTicket && $staff instanceof Staff) {
                $this->at($at(5, '09:10'), fn () => app(ReplyToTicket::class)->handle($staff, $closed, "Hallo Paul,\n\ndanke für den Hinweis. Das Baujahr ist jetzt wieder bearbeitbar, die Sperre kam von einem Fehler bei veröffentlichten Fahrzeugen.\n\nViele Grüße\nSupport-Team", SupportTicketStatus::Closed));
            }
        } finally {
            Mail::swap($mailer);
        }
    }

    /**
     * The ids the visual matrix addresses (ADM-21, ADM-22, ADM-26): the first ULID $write makes is fixed (like decisionId()), every
     * later one is random again.
     */
    public static function fixedId(string $seed, CarbonImmutable $now): string
    {
        return DemoSeeder::demoUlid($now->setTime(12, 0), 'admin-queue:'.$seed);
    }

    /**
     * @template T
     *
     * @param  Closure(): T  $write
     * @return T
     */
    private function withFixedId(string $id, Closure $write): mixed
    {
        Str::createUlidsUsing(function () use ($id): Ulid {
            Str::createUlidsNormally();

            return Ulid::fromString($id);
        });

        try {
            return $write();
        } finally {
            Str::createUlidsNormally();
        }
    }

    private function side(User $member, User $other): ConversationParticipant
    {
        return ConversationParticipant::query()
            ->where('conversation_id', Conversation::query()->where('pair_key', Conversation::pairKey($member, $other))->value('id'))
            ->where('user_id', $member->id)
            ->firstOrFail();
    }

    /**
     * @param  Closure(): mixed  $write
     */
    private function at(CarbonImmutable $moment, Closure $write): void
    {
        SeedClock::at($moment, $write);
    }
}
