<?php

// M4.12 Treffen (09 §8.7): messages of the event endpoints. The app writes its own screens; these reach it as field errors and 409s.
return [
    'ends_before_start' => 'Das Ende muss nach dem Beginn liegen.',
    'too_long' => 'Ein Treffen dauert höchstens :hours Stunden.',
    'starts_in_past' => 'Der Beginn muss in der Zukunft liegen.',
    'required_to_submit' => 'Das brauchen wir, bevor du das Treffen sendest.',
    'legal_only_required' => 'Bestätige, dass dein Treffen legal ist: keine Rennen und kein gefährliches Fahren auf öffentlichen Straßen.',
    'rules_required' => 'Akzeptiere die Regeln für Treffen, um fortzufahren.',
    'location_visibility_locked' => 'Wer den Ort sieht, kannst du nach dem Senden nicht mehr ändern.',
    'cancel_first' => 'Sag das Treffen zuerst ab, damit alle mit Zusage Bescheid bekommen. Danach kannst du es löschen.',
    'open_limit' => 'Du hast schon :max offene Treffen. Lösch einen Entwurf oder warte, bis ein Treffen vorbei ist.',
    'cannot_answer_own' => 'Bei deinem eigenen Treffen bist du als Organisator dabei.',
    'organiser_left' => 'Der Organisator hat sein Konto geschlossen.',
];
