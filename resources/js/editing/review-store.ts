import { create } from 'zustand';

/** Which table's Review & commit dialog is open (spec §4.3); one at a time. */
type State = {
    open: { connectionId: number; table: string } | null;
    /** Bumped on every open: the dialog fetches a fresh preview each time (pending changes may have changed). */
    nonce: number;
    openReview(connectionId: number, table: string): void;
    closeReview(): void;
};

export const useReview = create<State>()((set) => ({
    open: null,
    nonce: 0,
    openReview: (connectionId, table) =>
        set((s) => ({ open: { connectionId, table }, nonce: s.nonce + 1 })),
    closeReview: () => set((s) => (s.open ? { open: null } : s)),
}));
