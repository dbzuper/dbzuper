import { describe, expect, it } from 'vitest';
import {
    datePickerExport,
    loadDatePicker,
    preloadDatePicker,
} from './load-date-picker';

describe('loadDatePicker', () => {
    it('returns the same promise on repeat calls', () => {
        const first = loadDatePicker();
        expect(loadDatePicker()).toBe(first);
        preloadDatePicker();
        expect(loadDatePicker()).toBe(first);
    });

    it('hands a loaded export to React.lazy synchronously, so the first render does not suspend', async () => {
        const module = await loadDatePicker();
        let got: unknown;
        void datePickerExport('EditDatePicker')().then((m) => {
            got = m.default;
        });
        expect(got).toBe(module.EditDatePicker);
    });
});
