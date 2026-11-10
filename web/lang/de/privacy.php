<?php

// M3.6 Audit & Datenschutz (ADM-45…47): Anfragetypen, Vorlagen-Antworten (DE) und Prüftexte.
return [
    'types' => [
        'access' => 'Auskunft',
        'export' => 'Datenübertragbarkeit',
        'erasure' => 'Löschung',
        'rectification' => 'Berichtigung',
        'objection' => 'Widerspruch',
        'restriction' => 'Einschränkung der Verarbeitung',
    ],
    'validation' => [
        'assignee' => 'Wähle ein aktives Teammitglied, das Datenschutzanfragen bearbeiten darf.',
        'final_via_complete' => 'Zum Abschließen oder Ablehnen nutze „Abschließen“ mit Nachweis.',
        'outcome' => 'Wähle „abgeschlossen“ oder „abgelehnt“.',
    ],
    'retention' => [
        'unknown' => 'Diese Fristen gibt es nicht: :keys.',
    ],
    'reply' => [
        'note' => 'Aktenzeichen :reference. Bei Fragen erreichst du uns unter :support.',
        'received' => [
            'subject' => 'Deine Datenschutzanfrage :reference ist bei uns eingegangen',
            'heading' => 'Wir haben deine Anfrage erhalten',
            'body' => 'Deine Anfrage auf :type (Art. :article DSGVO) ist bei uns eingegangen. Wir antworten dir spätestens bis :date.',
        ],
        'identity' => [
            'subject' => 'Deine Datenschutzanfrage :reference: wir brauchen noch Angaben',
            'heading' => 'Bitte bestätige, dass die Anfrage von dir kommt',
            'body' => 'Damit wir keine Daten an die falsche Person geben, brauchen wir noch einen Nachweis. Am einfachsten schreibst du uns von der E-Mail-Adresse, mit der du bei SPEED CLUB angemeldet bist. Die Frist läuft bis :date.',
        ],
        'extension' => [
            'subject' => 'Deine Datenschutzanfrage :reference: wir brauchen mehr Zeit',
            'heading' => 'Wir verlängern die Frist',
            'body' => 'Für deine Anfrage auf :type brauchen wir länger. Nach Art. 12 Abs. 3 DSGVO verlängern wir die Frist bis :date. Der Grund:',
        ],
        'completed' => [
            'subject' => 'Deine Datenschutzanfrage :reference ist erledigt',
            'heading' => 'Deine Anfrage ist erledigt',
            'body' => 'Wir haben deine Anfrage auf :type (Art. :article DSGVO) bearbeitet.',
        ],
        'rejected' => [
            'subject' => 'Deine Datenschutzanfrage :reference',
            'heading' => 'Wir können deiner Anfrage nicht nachkommen',
            'body' => 'Deiner Anfrage auf :type können wir nicht oder nicht ganz nachkommen. Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren oder deine Rechte vor Gericht geltend machen (Art. 12 Abs. 4 DSGVO). Die Gründe:',
        ],
    ],
];
