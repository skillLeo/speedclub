<?php

// M2.6: moderation decisions in e-mails (statement of reasons, Art. 17 DSA) and the outcome for notifiers (Art. 16(5) DSA). The app
// renders SAFE-01 and SET-16 itself from the API's keys. Facts and ground are the decider's own words and are not translated.
return [
    // Dative: "Wir haben eine Meldung zu … geprüft."
    'target' => [
        'member' => 'deinem Profil :label',
        'vehicle' => 'deinem Build :label',
        'photo' => 'einem Foto deines Builds :label',
        'message' => 'einer Nachricht von dir',
        'build_update' => 'einem Update deines Builds :label',
        'modification' => 'einer Modifikation an deinem Build :label',
    ],
    'target_unnamed' => [
        'member' => 'deinem Profil',
        'vehicle' => 'einem deiner Builds',
        'photo' => 'einem deiner Fotos',
        'message' => 'einer Nachricht von dir',
        'build_update' => 'einem deiner Updates',
        'modification' => 'einer deiner Modifikationen',
    ],

    'outcome' => [
        'no_action' => 'Entscheidung: Wir haben keine Maßnahme ergriffen.',
        'remove_content' => 'Entscheidung: Wir haben den Inhalt entfernt. Andere sehen ihn nicht mehr.',
        'remove_profile' => 'Entscheidung: Wir haben deinen Anzeigenamen, deine Kurzbeschreibung sowie Profil- und Titelbild entfernt. Benutzername und Builds bleiben erhalten.',
        'restrict_messaging' => 'Entscheidung: Du kannst vorerst keine Nachrichten schreiben.',
        'restrict_messaging_until' => 'Entscheidung: Du kannst bis zum :date keine Nachrichten schreiben.',
        'restrict_publishing' => 'Entscheidung: Du kannst vorerst nichts veröffentlichen oder bearbeiten.',
        'restrict_publishing_until' => 'Entscheidung: Du kannst bis zum :date nichts veröffentlichen oder bearbeiten.',
        'suspend' => 'Entscheidung: Wir haben dein Konto gesperrt.',
        'suspend_until' => 'Entscheidung: Wir haben dein Konto bis zum :date gesperrt.',
        // M3.2: a reverse decision.
        'reverse' => 'Entscheidung: Wir haben eine frühere Maßnahme aufgehoben.',
    ],
    'reporter_outcome' => [
        'no_action' => 'Wir haben den gemeldeten Inhalt geprüft und keinen Verstoß festgestellt. Er bleibt online.',
        'remove_content' => 'Wir haben den gemeldeten Inhalt entfernt.',
        'measures' => 'Wir haben Maßnahmen gegen das betroffene Konto ergriffen.',
        'reversed' => 'Wir haben eine frühere Maßnahme aufgehoben.',
    ],

    // Art. 17(3)(a) DSA: what the decision applies to and for how long.
    'scope' => [
        'content' => 'Umfang und Dauer: Wir haben den Inhalt auf ganz SPEED CLUB entfernt, andere sehen ihn nirgends mehr. Das gilt dauerhaft, es sei denn, ein Einspruch hat Erfolg.',
        'account_until' => 'Umfang und Dauer: Die Maßnahme gilt für dein Konto bis zum :date und endet dann automatisch.',
        'account' => 'Umfang und Dauer: Die Maßnahme gilt für dein Konto und hat kein Enddatum. Sie endet, wenn ein Einspruch Erfolg hat oder wir sie aufheben.',
    ],

    'mail' => [
        'decision' => [
            'subject' => 'Unsere Entscheidung zu einer Meldung',
            'heading' => 'Wir haben eine Entscheidung getroffen',
            'intro' => 'Wir haben eine Meldung zu :target geprüft.',
            // M3.2: an own-initiative case (staff acted without a report).
            'subject_own' => 'Unsere Entscheidung zu deinem Konto oder deinen Inhalten',
            'intro_own' => 'Unser Team hat ohne Meldung eine Prüfung zu :target durchgeführt.',
            'detection_own' => 'Erkennung: Unser Team ist ohne Meldung darauf aufmerksam geworden; automatisierte Mittel haben es nicht erkannt.',
            'facts' => 'Sachverhalt: :facts',
            'ground' => 'Grund: :ground',
            'detection_no' => 'Erkennung: Der Inhalt wurde uns gemeldet; automatisierte Mittel haben ihn nicht erkannt.',
            'detection_yes' => 'Erkennung: Der Inhalt wurde mit automatisierten Mitteln erkannt.',
            'decision_no' => 'Prüfung: Eine Person aus unserem Team hat entschieden. Die Entscheidung wurde nicht automatisiert getroffen.',
            'decision_yes' => 'Prüfung: Die Entscheidung wurde mit automatisierten Mitteln getroffen.',
            'redress' => [
                'internal_complaint' => 'Einspruch: Du kannst bis zum :date Einspruch einlegen. Ein anderes Teammitglied prüft die Entscheidung dann erneut.',
                'internal_complaint_no_date' => 'Einspruch: Du kannst innerhalb von :months Monaten ab dieser Nachricht Einspruch einlegen. Ein anderes Teammitglied prüft die Entscheidung dann erneut.',
                'out_of_court' => "Außergerichtliche Streitbeilegung: Du kannst dich an eine zertifizierte außergerichtliche Streitbeilegungsstelle nach Art.\u{00A0}21 des Digital Services Act (DSA) wenden. Eine Liste dieser Stellen findest du unter :url",
                'court' => 'Gericht: Du kannst die Entscheidung außerdem von einem Gericht überprüfen lassen.',
            ],
            'action' => 'Entscheidung ansehen',
            'note' => 'Deinen Einspruch kannst du bis zum :date in der App einlegen (Einstellungen › Meldungen & Entscheidungen) oder an :support schicken. Nenn dabei die Nummer :reference.',
            'note_no_date' => 'Deinen Einspruch kannst du innerhalb von :months Monaten ab dieser Nachricht in der App einlegen (Einstellungen › Meldungen & Entscheidungen) oder an :support schicken. Nenn dabei die Nummer :reference.',
            'note_suspended' => 'Solange dein Konto gesperrt ist, kannst du dich nicht anmelden. Schick deinen Einspruch deshalb bis zum :date an :support und nenn dabei die Nummer :reference.',
            'note_suspended_no_date' => 'Solange dein Konto gesperrt ist, kannst du dich nicht anmelden. Schick deinen Einspruch deshalb innerhalb von :months Monaten ab dieser Nachricht an :support und nenn dabei die Nummer :reference.',
        ],
        // M3.2: a reverse decision lifted a measure (staff, or an upheld appeal). No redress: nothing is held against the member.
        'reversed' => [
            'subject' => 'Wir haben eine Maßnahme aufgehoben',
            'heading' => 'Die Maßnahme ist aufgehoben',
            'intro' => 'Wir haben unsere Entscheidung vom :date zu :target aufgehoben.',
            'lifted' => [
                'restrict_messaging' => 'Du kannst wieder Nachrichten schreiben.',
                'restrict_publishing' => 'Du kannst wieder veröffentlichen und bearbeiten.',
                'suspend' => 'Dein Konto ist nicht mehr gesperrt. Du kannst dich wieder anmelden.',
                'remove_content' => 'Der Inhalt ist wieder da, und andere sehen ihn wie vorher.',
                'remove_profile' => 'Anzeigename, Kurzbeschreibung sowie Profil- und Titelbild sind wieder da, soweit du sie nicht inzwischen neu gesetzt hast.',
            ],
            'facts' => 'Begründung: :facts',
            'action' => 'Entscheidung ansehen',
            'note' => 'Fragen dazu? Schreib uns an :support und nenn die Nummer :reference.',
        ],
        'received' => [
            'subject' => 'Wir haben deine Meldung erhalten',
            'heading' => 'Danke für deine Meldung',
            'intro' => 'Du hast uns diese Seite gemeldet: :url (Grund: :reason).',
            'next' => 'Wir prüfen die Meldung und schreiben dir an diese Adresse, sobald wir entschieden haben.',
            'reference' => 'Deine Meldungsnummer: :reference',
            'note' => 'Du hast diese Meldung nicht abgeschickt? Dann kannst du diese E-Mail ignorieren.',
        ],
        'outcome' => [
            'subject' => 'Unsere Entscheidung zu deiner Meldung',
            'heading' => 'Wir haben deine Meldung geprüft',
            'intro' => 'Du hast uns einen Inhalt gemeldet (Meldungsnummer :reference).',
            'redress_no_date' => "Bist du mit der Entscheidung nicht einverstanden? Dann schreib uns innerhalb von :months Monaten ab dieser Nachricht an :support und nenn die Meldungsnummer. Ein anderes Teammitglied prüft die Entscheidung dann erneut. Du kannst dich außerdem an eine zertifizierte außergerichtliche Streitbeilegungsstelle nach Art.\u{00A0}21 des Digital Services Act (DSA) wenden (Liste: :url) oder die Entscheidung von einem Gericht überprüfen lassen.",
            'redress' => "Bist du mit der Entscheidung nicht einverstanden? Dann schreib uns bis zum :date an :support und nenn die Meldungsnummer. Ein anderes Teammitglied prüft die Entscheidung dann erneut. Du kannst dich außerdem an eine zertifizierte außergerichtliche Streitbeilegungsstelle nach Art.\u{00A0}21 des Digital Services Act (DSA) wenden (Liste: :url) oder die Entscheidung von einem Gericht überprüfen lassen.",
            'note' => 'Danke, dass du hilfst, SPEED CLUB sicher zu halten.',
            'note_no_action' => 'Danke für deinen Hinweis. Auch wenn wir diesmal nichts entfernt haben, hilft uns jede Meldung.',
        ],
        // M3.4: the outcome of an internal complaint (Art. 20(4) DSA), to the person who appealed.
        'appeal' => [
            'subject' => 'Wir haben deinen Einspruch geprüft',
            'heading' => 'Dein Einspruch ist entschieden',
            'intro' => 'Du hast Einspruch gegen unsere Entscheidung :reference eingelegt. Ein anderes Teammitglied als bei der ersten Entscheidung hat ihn geprüft.',
            'upheld' => 'Ergebnis: Die Entscheidung bleibt bestehen.',
            'reversed' => 'Ergebnis: Wir haben die Entscheidung geändert. Was sich ändert, steht in der Entscheidung in der App.',
            'explanation' => 'Begründung: :text',
            'redress' => "Du kannst dich weiterhin an eine zertifizierte außergerichtliche Streitbeilegungsstelle nach Art.\u{00A0}21 des Digital Services Act (DSA) wenden (Liste: :url) oder die Entscheidung von einem Gericht überprüfen lassen.",
            'action' => 'Entscheidung ansehen',
        ],
        // M3.4: a reply of the team to a WEB-10 contact message (members read replies in the app).
        'support_reply' => [
            'subject' => 'Antwort auf deine Anfrage :reference',
            'heading' => 'Wir haben dir geantwortet',
            'intro' => 'Hier ist unsere Antwort auf deine Anfrage :reference:',
            'note' => 'Antworte einfach auf diese E-Mail oder schreib uns über das Kontaktformular und nenn die Nummer :reference.',
        ],
    ],

    // M3.2: the moderator's limit on suspensions (06_ADMIN_SPEC §2), shown in the admin.
    'suspension_limit' => 'Mit der Rolle Moderation kannst du höchstens :days Tage sperren, also bis spätestens :date.',

    'command' => [
        'decided' => 'Entschieden: :action (Entscheidung :id).',
        'not_open' => 'Dieser Fall ist nicht offen.',
        'not_found' => 'Diesen Fall gibt es nicht.',
        'invalid' => 'Die Angaben sind ungültig: :message',
    ],
];
