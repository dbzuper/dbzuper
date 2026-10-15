import type { WorkspaceState } from './store';

export function handleEscape(s: WorkspaceState): boolean {
    if (s.pathFrom || s.path) {
        s.clearPath();
        return true;
    }
    if (s.focus) {
        s.setFocus(null);
        return true;
    }
    if (s.selected) {
        s.select(null);
        return true;
    }
    return false;
}
