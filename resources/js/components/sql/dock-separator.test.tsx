import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from '@/universe/store';
import { DOCK_ID, DockSeparator } from './dock-separator';

const separator = () => screen.getByRole('separator');

describe('DockSeparator', () => {
    beforeEach(() => {
        useWorkspace.getState().reset();
        useWorkspace.getState().setDockHeight(320);
    });

    it('is a focusable, labelled separator that reports the dock height', () => {
        render(<DockSeparator />);
        expect(separator()).toHaveAttribute('tabindex', '0');
        expect(separator()).toHaveAttribute('aria-orientation', 'horizontal');
        expect(separator()).toHaveAttribute('aria-valuenow', '320');
        expect(separator()).toHaveAttribute('aria-valuemin', '160');
        expect(separator()).toHaveAttribute('aria-valuemax', '900');
        expect(separator()).toHaveAccessibleName('Resize SQL editor');
    });

    it('grows with Arrow Up and shrinks with Arrow Down by 24 px', () => {
        render(<DockSeparator />);
        fireEvent.keyDown(separator(), { key: 'ArrowUp' });
        expect(useWorkspace.getState().dockHeight).toBe(344);
        fireEvent.keyDown(separator(), { key: 'ArrowDown' });
        fireEvent.keyDown(separator(), { key: 'ArrowDown' });
        expect(useWorkspace.getState().dockHeight).toBe(296);
        expect(separator()).toHaveAttribute('aria-valuenow', '296');
    });

    it('jumps to the minimum with Home and the maximum with End', () => {
        render(<DockSeparator />);
        fireEvent.keyDown(separator(), { key: 'Home' });
        expect(useWorkspace.getState().dockHeight).toBe(160);
        fireEvent.keyDown(separator(), { key: 'End' });
        expect(useWorkspace.getState().dockHeight).toBe(900);
    });

    it('points at the dock region it resizes', () => {
        render(<DockSeparator />);
        expect(separator()).toHaveAttribute('aria-controls', DOCK_ID);
    });

    it('clamps to the minimum and maximum height', () => {
        render(<DockSeparator />);
        useWorkspace.getState().setDockHeight(170);
        fireEvent.keyDown(separator(), { key: 'ArrowDown' });
        expect(useWorkspace.getState().dockHeight).toBe(160);
        useWorkspace.getState().setDockHeight(890);
        fireEvent.keyDown(separator(), { key: 'ArrowUp' });
        expect(useWorkspace.getState().dockHeight).toBe(900);
    });
});
