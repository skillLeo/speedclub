<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * M3.4 moderation and support admin (m3.4-contract): the parts of a case's priority (ADM-20), the case an overturned appeal opened,
 * keyword rules with their daily hit counts (ADM-23), statement-of-reasons templates (ADM-24), support assignment, internal notes and
 * macros (ADM-25…27). Additive only. The default templates and macros are real copy (DE/EN), editable in the admin.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('moderation_cases', function (Blueprint $table): void {
            // Highest reason weight of the reports and the number of distinct reporters (SubmitReport keeps both).
            $table->unsignedSmallInteger('reason_weight')->default(0)->after('priority');
            $table->unsignedSmallInteger('reporter_count')->default(0)->after('reason_weight');
            // A keyword rule of the flag list filed the first report (automated_detection, Art. 17(3)(c) DSA).
            $table->boolean('automated')->default(false)->after('reporter_count');
            // The appeal whose outcome this case records (an overturned appeal: the reversal or the new measure).
            $table->foreignUlid('appeal_id')->nullable()->after('origin')->constrained('appeals')->nullOnDelete();
            $table->index(['status', 'created_at']);
        });

        // decisions(subject_id, decided_at), which the repeat-target part of the priority reads, exists since 2026_11_12_100000.

        Schema::create('keyword_rules', function (Blueprint $table): void {
            $table->id();
            $table->string('term', 100);
            // KeywordNormaliser::term(): what is matched, unique across both lists.
            $table->string('normalized', 120)->unique();
            $table->string('list', 8)->index();
            $table->foreignId('created_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('keyword_rule_hits', function (Blueprint $table): void {
            $table->foreignId('keyword_rule_id')->constrained('keyword_rules')->cascadeOnDelete();
            $table->date('day');
            $table->string('field', 24);
            $table->unsignedInteger('hits')->default(0);

            $table->primary(['keyword_rule_id', 'day', 'field']);
            $table->index('day');
        });

        Schema::create('sor_templates', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('key', 60);
            $table->string('locale', 5);
            $table->string('action', 20);
            $table->string('label', 120);
            $table->text('facts');
            $table->string('ground', 2000);
            $table->string('ground_document', 10);
            $table->string('ground_section', 100)->nullable();
            $table->unsignedSmallInteger('sort')->default(0);
            $table->foreignId('updated_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamps();

            $table->unique(['key', 'locale']);
        });

        Schema::create('support_macros', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('key', 60);
            $table->string('locale', 5);
            $table->string('title', 120);
            $table->text('body');
            $table->unsignedSmallInteger('sort')->default(0);
            $table->foreignId('updated_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamps();

            $table->unique(['key', 'locale']);
        });

        Schema::table('support_tickets', function (Blueprint $table): void {
            $table->foreignId('assigned_staff_id')->nullable()->after('status')->constrained('staff')->nullOnDelete();
            $table->timestamp('last_activity_at')->nullable()->after('closed_at');
            $table->index(['status', 'last_activity_at']);
        });

        Schema::table('ticket_messages', function (Blueprint $table): void {
            // An internal note of the team: never sent, never shown to the member.
            $table->boolean('internal')->default(false)->after('body');
            $table->timestamp('mailed_at')->nullable()->after('internal');
        });

        DB::table('support_tickets')->whereNull('last_activity_at')->update(['last_activity_at' => DB::raw('updated_at')]);
        $this->backfillCases();
        $this->seedTemplates();
        $this->seedMacros();
    }

    public function down(): void
    {
        Schema::table('ticket_messages', function (Blueprint $table): void {
            $table->dropColumn(['internal', 'mailed_at']);
        });
        Schema::table('support_tickets', function (Blueprint $table): void {
            $table->dropIndex(['status', 'last_activity_at']);
            $table->dropConstrainedForeignId('assigned_staff_id');
            $table->dropColumn('last_activity_at');
        });
        Schema::dropIfExists('support_macros');
        Schema::dropIfExists('sor_templates');
        Schema::dropIfExists('keyword_rule_hits');
        Schema::dropIfExists('keyword_rules');
        Schema::table('moderation_cases', function (Blueprint $table): void {
            $table->dropIndex(['status', 'created_at']);
            $table->dropConstrainedForeignId('appeal_id');
            $table->dropColumn(['reason_weight', 'reporter_count', 'automated']);
        });
    }

    /** The two new priority parts for cases filed before M3.4, from their reports (as SubmitReport computes them). */
    private function backfillCases(): void
    {
        $weights = ['illegal' => 40, 'harassment' => 30, 'nudity' => 30, 'impersonation' => 20, 'spam' => 10, 'other' => 5];
        $illegal = ['hate_speech' => 50, 'privacy' => 50, 'street_racing' => 45];

        DB::table('moderation_cases')->orderBy('id')->select('id')->chunk(200, function ($cases) use ($weights, $illegal): void {
            foreach ($cases as $case) {
                $reports = DB::table('reports')->where('case_id', $case->id)->get(['reason', 'sub_reason', 'reporter_id', 'contact_email']);
                $weight = 0;
                $people = [];
                foreach ($reports as $report) {
                    $base = $report->reason === 'illegal' ? ($illegal[$report->sub_reason] ?? 40) : ($weights[$report->reason] ?? 0);
                    $weight = max($weight, $base);
                    $people[match (true) {
                        $report->reporter_id !== null => 'member:'.$report->reporter_id,
                        is_string($report->contact_email) && $report->contact_email !== '' => 'email:'.mb_strtolower($report->contact_email),
                        default => 'anonymous',
                    }] = true;
                }
                DB::table('moderation_cases')->where('id', $case->id)->update(['reason_weight' => $weight, 'reporter_count' => count($people)]);
            }
        });
    }

    private function seedTemplates(): void
    {
        $now = now();
        $rows = [];
        $templates = [
            ['spam', 'remove_content', 'community', '4', 1,
                ['Spam oder Werbung', 'Der Inhalt „{target}“ wirbt für einen Verkauf oder ein Gewerbe statt dein Auto zu zeigen. Er wurde am {date} gemeldet.', 'Community-Richtlinien: keine Werbung und kein Spam'],
                ['Spam or advertising', 'The content “{target}” advertises a sale or a business instead of showing your car. It was reported on {date}.', 'Community guidelines: no advertising and no spam']],
            ['harassment', 'restrict', 'community', '2', 2,
                ['Belästigung oder Beleidigung', 'Du hast andere Mitglieder in Nachrichten beleidigt und nach einer Ablehnung weiter angeschrieben ({target}, gemeldet am {date}).', 'Community-Richtlinien: respektvoller Umgang'],
                ['Harassment or insults', 'You insulted other members in messages and kept writing after they declined ({target}, reported on {date}).', 'Community guidelines: treat others with respect']],
            ['impersonation', 'suspend', 'terms', '6', 3,
                ['Identitätsmissbrauch', 'Das Konto {target} gibt sich als eine andere Person oder Firma aus. Uns liegen dazu Meldungen vom {date} vor.', 'AGB: echte Identität und eigene Inhalte'],
                ['Impersonation', 'The account {target} pretends to be another person or company. We received reports about it on {date}.', 'Terms: real identity and your own content']],
            ['nudity', 'remove_content', 'community', '3', 4,
                ['Nacktheit oder sexuelle Inhalte', 'Der Inhalt „{target}“ zeigt Nacktheit oder sexuelle Inhalte. Er wurde am {date} gemeldet.', 'Community-Richtlinien: keine sexuellen Inhalte'],
                ['Nudity or sexual content', 'The content “{target}” shows nudity or sexual content. It was reported on {date}.', 'Community guidelines: no sexual content']],
            ['illegal', 'remove_content', 'law', null, 5,
                ['Rechtswidriger Inhalt', 'Der Inhalt „{target}“ verstößt gegen geltendes Recht. Er wurde am {date} gemeldet.', 'Geltendes Recht (Vorschrift nennen, z. B. § 315d StGB)'],
                ['Illegal content', 'The content “{target}” breaks the law. It was reported on {date}.', 'Applicable law (name the provision, e.g. section 315d German Criminal Code)']],
            ['street_racing', 'remove_content', 'law', null, 6,
                ['Verherrlichung illegaler Rennen', 'Der Inhalt „{target}“ verherrlicht ein illegales Kraftfahrzeugrennen im öffentlichen Straßenverkehr. Er wurde am {date} gemeldet.', '§ 315d StGB (verbotene Kraftfahrzeugrennen) und Community-Richtlinien'],
                ['Glorifying illegal racing', 'The content “{target}” glorifies an illegal motor vehicle race on public roads. It was reported on {date}.', 'Section 315d German Criminal Code (prohibited motor vehicle races) and the community guidelines']],
        ];
        foreach ($templates as [$key, $action, $document, $section, $sort, $de, $en]) {
            foreach (['de' => $de, 'en' => $en] as $locale => [$label, $facts, $ground]) {
                $rows[] = [
                    'id' => (string) Str::ulid(), 'key' => $key, 'locale' => $locale, 'action' => $action, 'label' => $label, 'facts' => $facts,
                    'ground' => $ground, 'ground_document' => $document, 'ground_section' => $section, 'sort' => $sort, 'created_at' => $now, 'updated_at' => $now,
                ];
            }
        }
        DB::table('sor_templates')->insertOrIgnore($rows);
    }

    private function seedMacros(): void
    {
        $now = now();
        $rows = [];
        $macros = [
            ['received', 1,
                ['Danke, wir kümmern uns', "Hallo {name},\n\ndanke für deine Nachricht. Wir sehen uns das an und melden uns, sobald wir mehr wissen.\n\nViele Grüße\n{staff} vom SPEED CLUB Team"],
                ['Thanks, we are on it', "Hi {name},\n\nthanks for your message. We are looking into it and will get back to you as soon as we know more.\n\nBest regards\n{staff} from the SPEED CLUB team"]],
            ['qr_reissue', 2,
                ['QR-Sticker neu ausgeben', "Hallo {name},\n\neinen neuen QR-Code für dein Auto bekommst du in der App: Garage → dein Fahrzeug → QR-Code → „Neu ausgeben“. Der alte Sticker funktioniert danach nicht mehr.\n\nDeine Anfrage: {reference}\n\nViele Grüße\n{staff}"],
                ['Reissue a QR sticker', "Hi {name},\n\nyou can get a new QR code for your car in the app: Garage → your vehicle → QR code → “Reissue”. The old sticker stops working afterwards.\n\nYour request: {reference}\n\nBest regards\n{staff}"]],
            ['need_details', 3,
                ['Mehr Details nötig', "Hallo {name},\n\ndamit wir dir helfen können, brauchen wir noch ein paar Angaben: Welches Gerät nutzt du, und was genau passiert, wenn der Fehler auftritt?\n\nDeine Anfrage: {reference}\n\nViele Grüße\n{staff}"],
                ['More details needed', "Hi {name},\n\nto help you we need a few more details: which device do you use, and what exactly happens when the error appears?\n\nYour request: {reference}\n\nBest regards\n{staff}"]],
        ];
        foreach ($macros as [$key, $sort, $de, $en]) {
            foreach (['de' => $de, 'en' => $en] as $locale => [$title, $body]) {
                $rows[] = ['id' => (string) Str::ulid(), 'key' => $key, 'locale' => $locale, 'title' => $title, 'body' => $body, 'sort' => $sort, 'created_at' => $now, 'updated_at' => $now];
            }
        }
        DB::table('support_macros')->insertOrIgnore($rows);
    }
};
