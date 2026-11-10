import type { SchemaField } from './schema';

/**
 * The member form's layout for ADM-15's preview (DQ-588), the same rules as the app's GAR-10 (`mobile/src/features/garage/modForm.ts`
 * `modLayout`, `unitOf`; 02 §3.3, FS-6): Räder & Reifen in FELGEN and REIFEN with front/rear pairs side by side and the rear diameter
 * only while Mischbereifung is on (ADR-112); every other category lists its fields in order, front/rear pairs side by side. Keep the
 * two in step when one changes.
 */
export type LayoutRow =
    | { kind: 'single'; field: SchemaField }
    | { kind: 'pair'; fields: readonly [SchemaField, SchemaField] }
    | { kind: 'switch'; field: SchemaField };

export type LayoutGroup = { key: 'rims' | 'tyres' | 'details'; rows: LayoutRow[] };

export const WHEELS = 'wheels_tires';
const FRONT = /_front$/;
const RIM_ORDER = ['wheel_brand', 'wheel_model', 'diameter', 'width_front', 'et_front', 'bolt_pattern', 'spacer_front', 'finish', 'staggered'];
const TYRE_KEYS = new Set(['tyre_brand', 'tyre_model', 'tyre_size_front', 'tyre_size_rear']);

function rearOf(key: string): string | null {
    return FRONT.test(key) ? key.replace(FRONT, '_rear') : null;
}

function rowsOf(fields: readonly SchemaField[]): LayoutRow[] {
    const byKey = new Map(fields.map((field) => [field.key, field]));
    const taken = new Set<string>();
    const rows: LayoutRow[] = [];
    for (const field of fields) {
        if (taken.has(field.key)) continue;
        taken.add(field.key);
        if (field.type === 'boolean') {
            rows.push({ kind: 'switch', field });
            continue;
        }
        const rear = rearOf(field.key);
        const partner = rear ? byKey.get(rear) : undefined;
        if (partner && !taken.has(partner.key)) {
            taken.add(partner.key);
            rows.push({ kind: 'pair', fields: [field, partner] });
        } else {
            rows.push({ kind: 'single', field });
        }
    }
    return rows;
}

export function formLayout(categoryKey: string, fields: readonly SchemaField[], staggered: boolean): LayoutGroup[] {
    if (categoryKey !== WHEELS) return [{ key: 'details', rows: rowsOf(fields) }];
    const byKey = new Map(fields.map((field) => [field.key, field]));
    const rimFields = fields.filter((field) => !TYRE_KEYS.has(field.key));
    const known = RIM_ORDER.flatMap((key) => {
        const field = byKey.get(key);
        return field ? [field] : [];
    });
    const paired = new Set(rimFields.flatMap((field) => (rearOf(field.key) && byKey.has(rearOf(field.key) ?? '') ? [rearOf(field.key) ?? ''] : [])));
    paired.add('diameter_rear');
    const rest = rimFields.filter((field) => !RIM_ORDER.includes(field.key) && !paired.has(field.key));
    const rows: LayoutRow[] = [];
    for (const field of [...known, ...rest]) {
        const partner = field.key === 'diameter' ? (staggered ? byKey.get('diameter_rear') : undefined) : byKey.get(rearOf(field.key) ?? '');
        if (field.type === 'boolean') rows.push({ kind: 'switch', field });
        else rows.push(partner ? { kind: 'pair', fields: [field, partner] } : { kind: 'single', field });
    }
    const tyres = rowsOf(fields.filter((field) => TYRE_KEYS.has(field.key)));
    return [{ key: 'rims', rows }, ...(tyres.length > 0 ? [{ key: 'tyres' as const, rows: tyres }] : [])];
}

/** The unit after the value: rim width in J, diameters in ″ (§3.9 "19″ × 9,5J"), everything else as the schema says. */
export function unitOf(field: Pick<SchemaField, 'key' | 'unit'>): string | undefined {
    if (field.unit === 'in') return field.key.startsWith('width') ? 'J' : '″';
    return field.unit ?? undefined;
}
