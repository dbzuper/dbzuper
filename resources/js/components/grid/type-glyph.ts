import {
    Binary,
    Braces,
    Calendar,
    Hash,
    ToggleLeft,
    Type,
    type LucideIcon,
} from 'lucide-react';
import type { CellValue } from '@/grid/cells';

/** What a column holds, from its SQL type: the families `cellKind` tells apart, without NULL. */
export type CellKindFamily =
    | 'number'
    | 'text'
    | 'date'
    | 'boolean'
    | 'json'
    | 'binary';

const GLYPHS: Record<CellKindFamily, LucideIcon> = {
    number: Hash,
    text: Type,
    date: Calendar,
    boolean: ToggleLeft,
    json: Braces,
    binary: Binary,
};

export const typeGlyph = (kind: CellKindFamily): LucideIcon => GLYPHS[kind];

/** MySQL spells a boolean column `tinyint(1)`; PostgreSQL `boolean` (`bool` in result metadata). */
const BOOLEAN_TYPE = /^(bool|boolean|tinyint\(1\))$/i;

/**
 * The family of a column's SQL type, by `cellKind`'s rules (null without a type). `interval` and `point` hold no
 * number although they contain `int`. A `tinyint(1)` reads as boolean, before the integer rule.
 */
export function columnFamily(type: string | null): CellKindFamily | null {
    const t = (type ?? '').trim().toLowerCase();
    if (t === '') return null;
    if (BOOLEAN_TYPE.test(t)) return 'boolean';
    // MySQL reports TEXT columns in SQL results as a bare `blob`: the family is unknown, so no glyph.
    if (t === 'blob') return null;
    if (/blob|binary|bytea|varbinary|image/.test(t)) return 'binary';
    if (/json/.test(t)) return 'json';
    if (/date|time/.test(t)) return 'date';
    if (
        (/int|numeric|decimal|float|double|real|money|serial/.test(t) &&
            !/interval|point/.test(t)) ||
        // MySQL's result metadata names integer types by size.
        /^(tiny|short|long|longlong|newdecimal)$/.test(t)
    )
        return 'number';
    return 'text';
}

/** A boolean column's value as a boolean (MySQL's 0/1, PostgreSQL's t/f), else null: other tinyint values stay numbers. */
export function boolCell(
    value: CellValue,
    type: string | null,
): boolean | null {
    if (typeof value === 'boolean') return value;
    if (!BOOLEAN_TYPE.test((type ?? '').trim())) return null;
    if (value === 1 || value === '1' || value === 't' || value === 'true')
        return true;
    if (value === 0 || value === '0' || value === 'f' || value === 'false')
        return false;
    return null;
}
