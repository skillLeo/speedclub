import { getActiveLanguage, trans, transChoice } from 'laravel-vue-i18n';
import { formatNumber } from '../../../lib/format';

/** A field of a mod category as stored and versioned (App\Services\Catalog\SchemaVersions::field), with its data count on the page. */
export interface SchemaField {
    id: number;
    key: string;
    label: { de?: string; en?: string };
    type: string;
    unit: string | null;
    min: number | null;
    max: number | null;
    step: number | null;
    options: { value: string; label: { de?: string; en?: string } }[] | { pattern?: string | null; example?: string | null } | null;
    required: boolean;
    searchable: boolean;
    facet: boolean;
    sort: number;
    archived_at: string | null;
    data?: number;
}

export interface SchemaVersion {
    id: number;
    version: number;
    created_at: string | null;
    staff: string | null;
    reason: string | null;
    schema: SchemaField[];
}

/** The readable properties of a field, flat ("label.de", "options.sport"), for the version diff. */
function flat(field: SchemaField): Record<string, string> {
    const out: Record<string, string> = {
        [trans('catalog.schema.props.label_de')]: field.label.de ?? '',
        [trans('catalog.schema.props.label_en')]: field.label.en ?? '',
        [trans('catalog.schema.props.type')]: trans(`catalog.field_types.${field.type}`),
        [trans('catalog.schema.props.required')]: trans(field.required ? 'catalog.field.yes' : 'catalog.field.no'),
        [trans('catalog.schema.props.sort')]: String(field.sort),
        [trans('catalog.schema.props.state')]: trans(field.archived_at ? 'catalog.field.archived' : 'catalog.field.live'),
    };
    if (field.unit) out[trans('catalog.schema.props.unit')] = field.unit;
    if (field.min !== null) out[trans('catalog.schema.props.min')] = numberText(field.min);
    if (field.max !== null) out[trans('catalog.schema.props.max')] = numberText(field.max);
    if (field.step !== null) out[trans('catalog.schema.props.step')] = numberText(field.step);
    if (Array.isArray(field.options)) {
        for (const option of field.options) out[`${trans('catalog.schema.props.option')} ${option.value}`] = `${option.label.de ?? ''} / ${option.label.en ?? ''}`;
    } else if (field.options !== null) {
        if (field.options.pattern) out[trans('catalog.schema.props.pattern')] = field.options.pattern;
        if (field.options.example) out[trans('catalog.schema.props.example')] = field.options.example;
    }
    return out;
}

/** A field's name in the admin's language, its key when it has none (DQ-589: names, never raw keys, in titles and lists). */
export function fieldLabel(field: Pick<SchemaField, 'key' | 'label'>): string {
    const en = getActiveLanguage() === 'en';
    return (en ? (field.label.en ?? field.label.de) : (field.label.de ?? field.label.en)) || field.key;
}

/**
 * What changed between two versions (DQ-589): one row per field and property that differs, named "Spurplatten vorne · Einheit", so
 * DiffViewer shows "Spurplatten vorne · Einheit: – → mm" and nothing that stayed the same. A new field lists its properties as added,
 * a removed one as removed; an unchanged field gives no row.
 */
export function schemaDiff(before: SchemaField[] | null, after: SchemaField[]): { before: Record<string, string>; after: Record<string, string> } {
    const a = new Map((before ?? []).map((f) => [f.id, f]));
    const b = new Map(after.map((f) => [f.id, f]));
    const was: Record<string, string> = {};
    const is: Record<string, string> = {};
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        const old = a.get(id);
        const now = b.get(id);
        const field = now ?? old;
        if (field === undefined) continue;
        const name = fieldLabel(field);
        const x = old ? flat(old) : {};
        const y = now ? flat(now) : {};
        for (const prop of new Set([...Object.keys(x), ...Object.keys(y)])) {
            if (x[prop] === y[prop]) continue;
            const row = `${name} · ${prop}`;
            if (prop in x) was[row] = x[prop] ?? '';
            if (prop in y) is[row] = y[prop] ?? '';
        }
    }
    return { before: was, after: is };
}

/** The unit as the app writes it after a value (rim width J, diameters ″; formLayout.unitOf). */
function unitText(field: SchemaField): string | null {
    if (field.unit === 'in') return field.key.startsWith('width') ? 'J' : '″';
    return field.unit;
}

/** A number with the locale's decimal mark and a real minus sign (DQ-605). */
export function numberText(value: number): string {
    return formatNumber(value).replace('-', '−');
}

/** Constraints of a field in one line: "13–24″ · Schritt 0,5", "−50 bis 70 mm", "4 Optionen", "Mit Muster". */
export function constraintText(field: SchemaField): string {
    if (field.type === 'number') {
        const unit = unitText(field);
        const tight = unit === '″' || unit === 'J';
        let range: string | null = null;
        if (field.min !== null && field.max !== null) {
            range = field.min < 0 ? trans('catalog.schema.range', { min: numberText(field.min), max: numberText(field.max) }) : `${numberText(field.min)}–${numberText(field.max)}`;
        } else if (field.min !== null) range = trans('catalog.schema.from', { min: numberText(field.min) });
        else if (field.max !== null) range = trans('catalog.schema.to', { max: numberText(field.max) });
        const withUnit = range === null ? unit : unit === null ? range : `${range}${tight ? '' : ' '}${unit}`;
        return [withUnit, field.step !== null ? trans('catalog.schema.step', { step: numberText(field.step) }) : null].filter(Boolean).join(' · ') || '–';
    }
    if (field.type === 'select' && Array.isArray(field.options)) return transChoice('catalog.schema.options_count', field.options.length, { count: String(field.options.length) });
    if (field.type === 'text' && field.options !== null && !Array.isArray(field.options) && field.options.pattern) return trans('catalog.schema.pattern');
    return field.unit ?? '–';
}
