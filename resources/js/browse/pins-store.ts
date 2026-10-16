import { toast } from 'sonner';
import { create } from 'zustand';
import { pinsApi, type Pin } from '@/lib/pins-api';

type State = {
    byConnection: Record<number, Pin[]>;
    load: (connectionId: number) => Promise<void>;
    toggle: (connectionId: number, table: string) => Promise<void>;
    reorder: (connectionId: number, tables: string[]) => Promise<void>;
    isPinned: (connectionId: number, table: string) => boolean;
};

export const usePins = create<State>()((set, get) => {
    const list = (c: number) => get().byConnection[c] ?? [];
    const put = (c: number, pins: Pin[]) =>
        set((s) => ({ byConnection: { ...s.byConnection, [c]: pins } }));
    const attempt = async (
        c: number,
        optimistic: Pin[],
        run: () => Promise<Pin[] | null>,
    ) => {
        const before = list(c);
        put(c, optimistic);
        try {
            const result = await run();
            if (result) put(c, result);
        } catch {
            put(c, before);
            toast.error('Could not update pins.');
        }
    };

    return {
        byConnection: {},
        load: async (c) => {
            try {
                put(c, (await pinsApi.list(c)).pins);
            } catch {
                // Pins are a convenience: the sidebar works without them.
            }
        },
        isPinned: (c, table) => list(c).some((p) => p.table === table),
        toggle: (c, table) => {
            const found = list(c).find((p) => p.table === table);
            if (found)
                return attempt(
                    c,
                    list(c).filter((p) => p.id !== found.id),
                    async () => {
                        await pinsApi.remove(c, found.id);
                        return null;
                    },
                );
            const temp: Pin = {
                id: -Date.now(),
                table,
                position: list(c).length + 1,
            };
            return attempt(c, [...list(c), temp], async () => {
                const { pin } = await pinsApi.add(c, table);
                return list(c).map((p) => (p.id === temp.id ? pin : p));
            });
        },
        reorder: (c, tables) => {
            const byTable = new Map(list(c).map((p) => [p.table, p]));
            const ordered = tables
                .map((t) => byTable.get(t))
                .filter((p): p is Pin => !!p && p.id > 0);
            return attempt(
                c,
                ordered,
                async () =>
                    (
                        await pinsApi.reorder(
                            c,
                            ordered.map((p) => p.id),
                        )
                    ).pins,
            );
        },
    };
});
