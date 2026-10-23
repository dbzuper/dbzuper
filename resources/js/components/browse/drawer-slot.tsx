import { createContext, useContext } from 'react';

/**
 * Where the active table tab renders its row drawer: a full-height column beside the tab panel
 * and the SQL dock, so the dock doesn't squeeze the drawer. Null (tests, no workspace) renders
 * the drawer inline next to the grid.
 */
export const DrawerSlotContext = createContext<HTMLElement | null>(null);

export function useDrawerSlot(): HTMLElement | null {
    return useContext(DrawerSlotContext);
}
