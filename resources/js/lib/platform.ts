type NavigatorWithUAData = Navigator & {
    userAgentData?: { platform?: string };
};

/** True on Apple platforms, where the command key replaces Ctrl. */
export function isApplePlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as NavigatorWithUAData;
    const platform = nav.userAgentData?.platform || nav.platform || '';
    return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The command palette shortcut as shown to this user: "⌘K" on a Mac, "Ctrl K" elsewhere. */
export function paletteShortcutHint(): string {
    return isApplePlatform() ? '⌘K' : 'Ctrl K';
}

/** Monaco's "Tab moves focus" toggle as shown to this user: Ctrl+M, or ⌃⇧M on a Mac (where ⌘M minimises). */
export function tabFocusShortcutHint(): string {
    return isApplePlatform() ? '⌃⇧M' : 'Ctrl+M';
}

/** The SQL dock shortcut as shown to this user: "⌘J" on a Mac, "⌃J" elsewhere. */
export function dockShortcutHint(): string {
    return isApplePlatform() ? '⌘J' : '⌃J';
}
