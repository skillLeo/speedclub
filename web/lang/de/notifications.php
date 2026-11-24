<?php

// Push texts of M2.2, rendered in the recipient's language by App\Services\Notifications\NotificationTexts. The app renders the list rows
// (HOME-02) itself from type, actors and actor_count. Never message content (ADR-035).
return [
    'title' => 'Speedclub',
    'new_follower' => '{1} @:name folgt dir jetzt.|{2} @:name und ein weiteres Mitglied folgen dir jetzt.|[3,*] @:name und :count weitere folgen dir jetzt.',
    'followed_published' => [
        'vehicle' => '@:name hat einen neuen Build veröffentlicht: :vehicle',
        'update' => '@:name hat ein Update zu :vehicle veröffentlicht.',
    ],
    'build_saved' => '{1} Ein Mitglied hat letzte Woche deinen Build :vehicle gespeichert.|[2,*] :count Mitglieder haben letzte Woche deinen Build :vehicle gespeichert.',
    // M2.6, urgent: names nothing of the decision; the app opens SAFE-01.
    'moderation_decision' => 'Wir haben eine Entscheidung zu deinen Inhalten oder deinem Konto getroffen. Tippe für die Begründung.',
    // M2.7 [SIG]: scans in total, never who scanned.
    'qr_milestone' => 'Dein Sticker an :vehicle wurde schon :count-mal gescannt.',
    'hu_au_reminder' => 'Die HU/AU für :vehicle ist im :month fällig.',
    // M3.3: the member's catalogue request (ADM-14). In-app only; the app renders the row itself.
    'catalog_request' => [
        'accepted' => 'Dein Fahrzeug ist jetzt im Katalog: :vehicle.',
        'rejected' => 'Deine Katalog-Anfrage für :vehicle haben wir nicht übernommen. Tippe für die Begründung.',
    ],
    // Phase 3 (SET-15): the team answered a support request. In-app only; the app renders the row itself, never the answer's text.
    // M4.7 (09 §8.4): the login alert, pushed to the account's other devices. Names the device only.
    'security_new_device' => 'Neue Anmeldung bei Speedclub auf :device. Warst du das nicht? Tippe, um dein Konto zu sichern.',
    'support_reply' => 'Das Support-Team hat auf deine Anfrage :reference geantwortet.',
    // The e-mail of the HU/AU reminder, only when switched on in SET-09.
    'hu_au_mail' => [
        'subject' => 'HU/AU für :vehicle im :month',
        'heading' => 'Bald ist HU/AU fällig',
        'intro' => 'Die HU/AU für :vehicle ist im :month fällig. Denk rechtzeitig an einen Termin.',
        'action' => 'Fahrzeug öffnen',
        'note' => 'Du bekommst diese E-Mail, weil du sie unter Einstellungen › Mitteilungen eingeschaltet hast. Dort kannst du sie auch wieder ausschalten.',
    ],
    // M4.11 (09 §8.17): names who and which build, never a count for anybody but the owner, never what was written.
    'reaction' => [
        'build_update' => '{1} @:name hat auf dein Update zu :vehicle reagiert.|{2} @:name und ein weiteres Mitglied haben auf dein Update zu :vehicle reagiert.|[3,*] @:name und :count weitere haben auf dein Update zu :vehicle reagiert.',
        'vehicle' => '{1} @:name hat auf deinen Build :vehicle reagiert.|{2} @:name und ein weiteres Mitglied haben auf deinen Build :vehicle reagiert.|[3,*] @:name und :count weitere haben auf deinen Build :vehicle reagiert.',
    ],
    'mention' => [
        'update' => '@:name hat dich in einem Update zu :vehicle erwähnt.',
        'comment' => '@:name hat dich in einem Kommentar zu :vehicle erwähnt.',
    ],
    'comment' => [
        'update' => '{1} @:name hat dein Update zu :vehicle kommentiert.|{2} @:name und ein weiteres Mitglied haben dein Update zu :vehicle kommentiert.|[3,*] @:name und :count weitere haben dein Update zu :vehicle kommentiert.',
        'reply' => '@:name hat auf deinen Kommentar zu :vehicle geantwortet.',
        // R5-5: a comment on the car itself.
        'vehicle' => '{1} @:name hat deinen Build :vehicle kommentiert.|{2} @:name und ein weiteres Mitglied haben deinen Build :vehicle kommentiert.|[3,*] @:name und :count weitere haben deinen Build :vehicle kommentiert.',
    ],
    'vehicle_follower' => '{1} @:name folgt jetzt deinem Build :vehicle.|{2} @:name und ein weiteres Mitglied folgen jetzt deinem Build :vehicle.|[3,*] @:name und :count weitere folgen jetzt deinem Build :vehicle.',
    // M4.12 (09 §8.17): the event's title and start, never an update's text or a rejection reason in a push.
    'event_review' => [
        'approved' => '„:title“ ist freigegeben und jetzt sichtbar.',
        'rejected' => '„:title“ wurde nicht freigegeben. Den Grund findest du beim Treffen.',
    ],
    'event_promoted' => 'Ein Platz ist frei geworden: Du bist bei „:title“ jetzt dabei.',
    'event_reminder' => [
        '24h' => 'Morgen um :time Uhr: „:title“.',
        '2h' => 'In zwei Stunden geht es los: „:title“ um :time Uhr.',
    ],
    'event_update' => [
        'update' => 'Neues vom Organisator zu „:title“.',
        'changed' => 'Zeit oder Ort von „:title“ haben sich geändert.',
    ],
    'event_cancelled' => '„:title“ wurde abgesagt.',
    'event_reminder_mail' => [
        'subject_24h' => 'Morgen: :title',
        'subject_2h' => 'In zwei Stunden: :title',
        'heading' => 'Dein Treffen steht an',
        'intro' => '„:title“ beginnt am :date um :time Uhr. Ort, Regeln und Updates findest du beim Treffen.',
        'action' => 'Treffen öffnen',
        'note' => 'Du bekommst diese E-Mail, weil du bei diesem Treffen zugesagt und Erinnerungen per E-Mail unter Einstellungen › Mitteilungen eingeschaltet hast.',
    ],
    // M4.13 (09 §8.8): maintenance reminders, the owner's own vehicle and item (MaintenanceTexts); SET-09 "Fälligkeiten".
    'maintenance_due' => [
        'items' => [
            'service' => 'Der Service',
            'oil_change' => 'Der Ölwechsel',
            'brake_fluid' => 'Der Bremsflüssigkeitswechsel',
        ],
        'custom' => '„:title“',
        'date' => ':item für :vehicle ist am :date fällig.',
        'today' => ':item für :vehicle ist heute fällig.',
        'km' => ':item für :vehicle ist bei :km fällig.',
        'undated' => ':item für :vehicle steht an.',
        'hu_au' => 'Die HU/AU für :vehicle ist im :month fällig.',
        'tyres_winter' => 'Von O bis O: Zeit für Winterreifen an :vehicle. Reifenwechsel bis :date.',
        'tyres_summer' => 'Von O bis O: Zeit für Sommerreifen an :vehicle. Reifenwechsel bis :date.',
        'insurance' => 'Stichtag :date: Bis dahin kannst du die Kfz-Versicherung für :vehicle kündigen und wechseln.',
    ],
    'maintenance_mail' => [
        'subject' => 'Fällig: Wartung für :vehicle',
        'heading' => 'Bald ist etwas fällig',
        'action' => 'Wartung öffnen',
        'note' => 'Du bekommst diese E-Mail, weil du E-Mails zu Fälligkeiten unter Einstellungen › Mitteilungen eingeschaltet hast. Dort kannst du sie auch wieder ausschalten.',
    ],
    // M4.14 Betriebe (09 §8.10), nur in der App.
    'business_review' => [
        'verified' => '„:name“ ist verifiziert und jetzt öffentlich sichtbar.',
        'rejected' => '„:name“ wurde nicht verifiziert. Den Grund findest du in deinem Betriebs-Dashboard.',
        'suspended' => '„:name“ ist gesperrt und nicht mehr öffentlich. Den Grund findest du in deinem Betriebs-Dashboard.',
        'reinstated' => '„:name“ ist wieder freigeschaltet.',
        'reopened' => '„:name“ wird noch einmal geprüft und ist so lange nicht öffentlich.',
    ],
    'business_tag' => [
        'business' => [
            'requested' => 'Neue Markierung für „:name“: Bestätige den Einbau an :vehicle.',
            'accepted' => 'Der Einbau an :vehicle ist bestätigt und steht jetzt in eurem Portfolio.',
            'declined' => 'Die Markierung an :vehicle wurde abgelehnt.',
        ],
        'member' => [
            'requested' => '„:name“ möchte deinen :vehicle ins Portfolio aufnehmen. Bestätige den Einbau.',
            'accepted' => '„:name“ hat den Einbau an deinem :vehicle bestätigt.',
            'declined' => '„:name“ hat die Markierung an deinem :vehicle abgelehnt.',
        ],
    ],
    // SEC-414-01: Team-Einladungen (nur in der App).
    'business_invite' => [
        'invited' => '„:name“ lädt dich ins Team ein. Nimm die Einladung an oder lehne sie ab.',
        'removed' => '„:name“ hat dich aus dem Team genommen.',
        'accepted' => ':username ist jetzt im Team von „:name“.',
        'declined' => ':username hat die Einladung ins Team von „:name“ abgelehnt.',
        'left' => ':username hat das Team von „:name“ verlassen.',
    ],
    // R4-2.3 Crews (nur in der App).
    'crew' => [
        'request_received' => ':username möchte in die Crew „:name“. Nimm die Anfrage an oder lehne sie ab.',
        'request_approved' => 'Du bist jetzt in der Crew „:name“.',
        'invited' => ':username lädt dich in die Crew „:name“ ein.',
    ],
    // M5.9b STREET DEX: the owner's own car, the day's count and, where allowed, its city; never who spotted it.
    'spot_alert' => [
        'city' => '{1} Dein :vehicle wurde heute in :city gespottet.|[2,*] Dein :vehicle wurde heute :count-mal in :city gespottet.',
        'cities' => '[0,*] Dein :vehicle wurde heute :count-mal in :cities Städten gespottet.',
        'plain' => '{1} Dein :vehicle wurde heute gespottet.|[2,*] Dein :vehicle wurde heute :count-mal gespottet.',
    ],
    // M5.9d supporting system: push texts (the in-app list writes its own) and the SET-09 category labels of the gift types.
    'badge_unlocked' => 'Neues Abzeichen: „:name“.',
    'car_of_the_day_owner' => 'Dein :vehicle ist heute Car of the Day und steht bis morgen um 18 Uhr ganz oben auf Start.',
    'car_of_the_day' => 'Car of the Day: :vehicle von :name.',
    'invite_accepted' => 'Jemand hat sich mit deiner Einladung :code angemeldet. Ihr habt jetzt beide das Abzeichen „Crew Starter“.',
    'categories' => [
        'spots' => 'Spots',
        'badges' => 'Abzeichen',
        'car_of_the_day' => 'Car of the Day',
        'invites' => 'Einladungen',
        // M5.8.
        'forum' => 'Forum',
        // M5.6.
        'events_nearby' => 'Treffen in deiner Nähe',
        // M5.7.
        'build_prompts' => 'Build-Erinnerungen',
        'weekly_recap' => 'Wochenrückblick',
    ],
    // M5.8 Forum (m5.8-contract §5): the thread's public title, never the text of a post.
    'forum_reply' => [
        'thread' => '{1} @:name hat auf „:title“ geantwortet.|{2} @:name und ein weiteres Mitglied haben auf „:title“ geantwortet.|[3,*] @:name und :count weitere haben auf „:title“ geantwortet.',
        'post' => '@:name hat in „:title“ auf deinen Beitrag geantwortet.',
    ],
    'forum_mention' => '@:name hat dich in „:title“ erwähnt.',
    'forum_solved' => 'Deine Antwort in „:title“ wurde als Lösung markiert.',
    // M5.6 Treffen (m5.6-contract §4.6, §6): the number of photos waiting, never who sent them; the weekly nearby meets.
    'event_gallery_pending' => '{1} Ein neues Foto zu „:title“ wartet auf deine Freigabe.|[2,*] :count neue Fotos zu „:title“ warten auf deine Freigabe.',
    'event_nearby' => [
        'title' => 'Neue Treffen in deiner Nähe',
        'body' => '{1} :title in den nächsten zwei Wochen.|{2} :title und ein weiteres in den nächsten zwei Wochen.|[3,*] :title und :count weitere in den nächsten zwei Wochen.',
    ],
    'event_nearby_mail' => [
        'subject' => 'Neue Treffen in deiner Nähe',
        'heading' => 'Neue Treffen in deiner Nähe',
        'intro' => '{1} Diese Woche ist ein neues Treffen rund um :region dazugekommen:|[2,*] Diese Woche sind :count neue Treffen rund um :region dazugekommen:',
        'line' => ':date · :city · :title',
        'more' => '{1} Ein weiteres findest du in der App.|[2,*] :count weitere findest du in der App.',
        'action' => 'Treffen ansehen',
        'unsubscribe' => 'Diese E-Mails abbestellen',
        'note' => 'Du bekommst diese E-Mail, weil du „Neue Treffen in deiner Nähe“ unter Einstellungen › Mitteilungen eingeschaltet hast. Über den Link oben bestellst du sie ab; dein Mailprogramm bietet dafür oft auch „Abbestellen“ an.',
        'region' => 'deine Region',
    ],
    // M5.7 Engagement (10 §6.2, §6.3, m5.7-contract §4.2, §6): the build prompt and the weekly recap. Never a zero, never a comparison with
    // last week, never who; no guilt ("immer noch nicht" etc.).
    'plan_due' => 'Ist das :mod schon verbaut? Trag es ein.',
    'weekly_recap' => [
        'title' => 'Deine Woche bei Speedclub',
        'parts' => [
            'views' => '{1} 1 Aufruf|[2,*] :count Aufrufe',
            'sticker_scans' => '{1} 1 Sticker-Scan|[2,*] :count Sticker-Scans',
            'new_followers' => '{1} 1 neuer Follower|[2,*] :count neue Follower',
            'spots' => '{1} 1 Spot|[2,*] :count Spots',
            'maintenance_due' => '{1} 1 Wartung bald fällig|[2,*] :count Wartungen bald fällig',
            'events_nearby' => '{1} 1 Treffen in deiner Nähe|[2,*] :count Treffen in deiner Nähe',
        ],
    ],
    'weekly_recap_mail' => [
        'subject' => 'Deine Woche bei Speedclub',
        'heading' => 'Deine Woche bei Speedclub',
        'intro' => 'Das war los bei deinen Builds:',
        'action' => 'Statistiken ansehen',
        'unsubscribe' => 'Wochenrückblick per E-Mail abbestellen',
        'note' => 'Du bekommst diese E-Mail, weil der Wochenrückblick an ist und diese Woche kein Push bei dir angekommen ist. Mit dem Link oben bestellst du sie ab; in der App unter Einstellungen › Mitteilungen schaltest du den Wochenrückblick ganz aus.',
    ],
];
