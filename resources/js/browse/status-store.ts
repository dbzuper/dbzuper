import { create } from 'zustand';
import type { Total } from './counts';

/** What a table tab tells the status bar about its rows on screen; `from = to = 0` is an empty page. */
export type TabStatus = { from: number; to: number; total: Total; ms: number };

type State = {
    /** By tab id: only a table tab whose rows are on screen has an entry. */
    byTab: Record<string, TabStatus>;
    publish(tabId: string, s: TabStatus): void;
    clear(tabId: string): void;
};

export const useTabStatus = create<State>()((set) => ({
    byTab: {},
    publish: (tabId, s) =>
        set((st) => ({ byTab: { ...st.byTab, [tabId]: s } })),
    clear: (tabId) =>
        set((st) => {
            if (!(tabId in st.byTab)) return st;
            const byTab = { ...st.byTab };
            delete byTab[tabId];
            return { byTab };
        }),
}));
