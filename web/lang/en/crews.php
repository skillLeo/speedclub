<?php

// R4-2.3 Crews: validation and error messages of the crew API. The app writes its own screen texts.
return [
    'name_length' => 'The crew name needs :min to :max characters.',
    'name_characters' => 'The crew name may contain letters, digits, spaces and - _ . & \' !',
    'name_reserved' => 'We cannot give this name to a crew. Please choose another one.',
    'name_taken' => 'There is already a crew with this name.',
    'memberships_limit' => 'You are already in :max crews. Leave one before you join another.',
    'founded_limit' => 'You have already founded :max crews. Hand one over or delete it before you found a new one.',
    'requests_limit' => 'You already have :max open join requests. Wait for an answer or withdraw one.',
    'invites_limit' => 'Your crew already has :max open invitations. Withdraw one before you send more.',
    'invite_only' => 'You can only join this crew by invitation.',
    'not_active' => 'This crew is hidden at the moment. You can change it once it is visible again.',
    'founder_cannot_leave' => 'As the founder you cannot leave the crew. Hand it over to another member or delete it first.',
    'confirm_name_mismatch' => 'To confirm, type the crew name exactly as it is shown.',
    'member_unknown' => 'We cannot invite this username.',
    'member_already' => 'This member is already in your crew.',
    'member_invited' => 'This member has already been invited.',
    'remove_not_allowed' => 'Admins can only remove members, not the founder or other admins.',
    'role_fixed' => 'The founder’s role only changes through a hand-over.',
    'hand_over_member' => 'You can only hand over to another member of the crew.',
    'hand_over_inactive' => 'You can only hand over to an active member whose account is neither suspended nor being deleted.',
];
