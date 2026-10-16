import type { SVGAttributes } from 'react';

/** The DBSuperb orbit mark: a filled node with a thin ring and two orbiting dots. Follows currentColor. */
export default function AppLogoIcon(props: SVGAttributes<SVGElement>) {
    return (
        <svg
            {...props}
            viewBox="0 0 40 40"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
        >
            <circle
                cx="20"
                cy="20"
                r="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
            />
            <circle cx="20" cy="20" r="6" fill="currentColor" />
            <circle cx="30.6" cy="9.4" r="3" fill="currentColor" />
            <circle cx="9.4" cy="30.6" r="3" fill="currentColor" />
        </svg>
    );
}
