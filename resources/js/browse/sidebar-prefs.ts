import { create } from 'zustand';
import {
    readSidebarPrefs,
    SIDEBAR_MAX,
    SIDEBAR_MIN,
    writeSidebarPrefs,
    type SidebarPrefs,
} from './local-prefs';

export const useSidebarPrefs = create<
    SidebarPrefs & { setWidth: (px: number) => void; toggle: () => void }
>()((set, get) => ({
    ...readSidebarPrefs(),
    setWidth: (px) => {
        const width = Math.min(
            SIDEBAR_MAX,
            Math.max(SIDEBAR_MIN, Math.round(px)),
        );
        set({ width });
        writeSidebarPrefs({ width, collapsed: get().collapsed });
    },
    toggle: () => {
        const collapsed = !get().collapsed;
        set({ collapsed });
        writeSidebarPrefs({ width: get().width, collapsed });
    },
}));
