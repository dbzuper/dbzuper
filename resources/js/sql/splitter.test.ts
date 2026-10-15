import { describe, expect, it } from 'vitest';
import { splitStatements, statementAt } from './splitter';

describe('statementAt', () => {
    const text = 'select 1;\nselect 2;\n\nselect 3';

    it('finds the statement containing the cursor', () => {
        expect(statementAt(text, text.indexOf('2'), 'sqlite')?.sql).toBe(
            'select 2',
        );
    });

    it('uses the statement just before the cursor when the cursor sits after its semicolon', () => {
        expect(statementAt(text, text.indexOf('2;') + 2, 'sqlite')?.sql).toBe(
            'select 2',
        );
    });

    it('returns null for empty text', () => {
        expect(statementAt('   ', 1, 'sqlite')).toBeNull();
    });

    it('uses UTF-16 offsets', () => {
        const s = "select '🚀'; select 2";
        const [first] = splitStatements(s, 'sqlite');
        expect(s.slice(first.start, first.end)).toBe("select '🚀'");
    });
});
