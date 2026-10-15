import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

type Props = {
    onError: (error: unknown) => void;
    children: ReactNode;
};

/**
 * Catches failures while loading or rendering the universe (a lazy chunk that
 * fails to load, Sigma throwing on mount). It reports the error and renders
 * nothing; the page then switches to the list view.
 */
export class UniverseBoundary extends Component<Props, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        console.error('Universe failed to render', error, info.componentStack);
        this.props.onError(error);
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}
