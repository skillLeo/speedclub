import { trans } from 'laravel-vue-i18n';

/**
 * The German/English label of an audit action key ("staff.signed_in" → "Angemeldet"), from lang/admin/<locale>/audit.json `actions`
 * (DQ-510). Unknown keys stay as they are: a new event is still readable before it has a label.
 */
export function actionLabel(action: string): string {
    const key = `audit.actions.${action}`;
    const text = trans(key);
    return text === key ? action : text;
}

/**
 * Who did it, for a timeline entry of App\Http\Controllers\Admin\Support\ActivityFeed: the name, else the kind of actor (a staff account
 * that no longer exists, a member without a username); null for the system.
 */
export function actorName(entry: { actor: string | null; actor_type?: string | null; actor_id?: string | null }): string | null {
    if (entry.actor !== null) return entry.actor;
    if (entry.actor_type === 'staff') return `${trans('audit.actor.staff')} ${entry.actor_id ?? ''}`.trim();
    if (entry.actor_type === 'member') return trans('audit.actor.member');
    return null;
}
