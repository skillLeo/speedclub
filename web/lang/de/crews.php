<?php

// R4-2.3 Crews: validation and error messages of the crew API (du, short). The app writes its own screen texts.
return [
    'name_length' => 'Der Crew-Name braucht :min bis :max Zeichen.',
    'name_characters' => 'Der Crew-Name darf Buchstaben, Ziffern, Leerzeichen und - _ . & \' ! enthalten.',
    'name_reserved' => 'Diesen Namen können wir für Crews nicht vergeben. Wähl bitte einen anderen.',
    'name_taken' => 'Eine Crew mit diesem Namen gibt es schon.',
    'memberships_limit' => 'Du bist schon in :max Crews. Verlass eine, bevor du einer neuen beitrittst.',
    'founded_limit' => 'Du hast schon :max Crews gegründet. Übergib oder lösch eine, bevor du eine neue gründest.',
    'requests_limit' => 'Du hast schon :max offene Beitrittsanfragen. Warte auf eine Antwort oder zieh eine zurück.',
    'invites_limit' => 'Eure Crew hat schon :max offene Einladungen. Zieh eine zurück, bevor du weitere verschickst.',
    'invite_only' => 'Dieser Crew kannst du nur auf Einladung beitreten.',
    'not_active' => 'Diese Crew ist gerade ausgeblendet. Ändern kannst du sie erst, wenn sie wieder sichtbar ist.',
    'founder_cannot_leave' => 'Als Gründer kannst du die Crew nicht verlassen. Übergib sie zuerst an ein anderes Mitglied oder lösch sie.',
    'confirm_name_mismatch' => 'Gib zur Bestätigung den Namen der Crew genau so ein, wie er angezeigt wird.',
    'member_unknown' => 'Diesen Benutzernamen können wir nicht einladen.',
    'member_already' => 'Dieses Mitglied ist schon in eurer Crew.',
    'member_invited' => 'Dieses Mitglied ist schon eingeladen.',
    'remove_not_allowed' => 'Admins können nur Mitglieder entfernen, nicht den Gründer oder andere Admins.',
    'role_fixed' => 'Die Rolle des Gründers ändert sich nur durch eine Übergabe.',
    'hand_over_member' => 'Übergeben kannst du nur an ein anderes Mitglied der Crew.',
    'hand_over_inactive' => 'Übergeben kannst du nur an ein aktives Mitglied, dessen Konto nicht gesperrt ist oder gelöscht wird.',
];
