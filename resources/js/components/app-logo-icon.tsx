import type { SVGAttributes } from 'react';

/**
 * Each cut is drawn for a size range: `micro` on a 16 px pixel grid (16–23 px), `small` with heavier rings
 * (24–47 px) and `full` with the finer grid (48 px and up).
 * The masters live in docs/logo/kit.
 */
const CUTS = {
    micro: {
        body: 'M244.45 85.39A124 124 0 1 1 170.61 11.55A15 15 0 0 1 160.3 39.72A94 94 0 1 0 216.28 95.7A15 15 0 0 1 244.45 85.39ZM96 72.57L96 96L72.57 96A64 64 0 0 1 96 72.57ZM66.03 112L96 112L96 144L66.03 144A64 64 0 0 1 66.03 112ZM72.57 160L96 160L96 183.43A64 64 0 0 1 72.57 160ZM144 66.03L144 96L112 96L112 66.03A64 64 0 0 1 144 66.03ZM112 112L144 112L144 144L112 144ZM112 160L144 160L144 189.97A64 64 0 0 1 112 189.97ZM183.43 96L160 96L160 72.57A64 64 0 0 1 183.43 96ZM160 112L189.97 112A64 64 0 0 1 189.97 144L160 144ZM160 160L183.43 160A64 64 0 0 1 160 183.43Z',
        dots: 'M183.07 50.93a22 22 0 1 0 44 0a22 22 0 1 0-44 0Z',
    },
    small: {
        body: 'M228.27 87.88A108 108 0 1 1 168.12 27.73A11 11 0 0 1 159.95 48.15A86 86 0 1 0 207.85 96.05A11 11 0 0 1 228.27 87.88ZM62.86 138.6A66 66 0 1 1 117.4 193.14A9 9 0 0 1 120.29 175.38A48 48 0 1 0 80.62 135.71A9 9 0 0 1 62.86 138.6ZM107 81.69H117V174.31H107ZM81.69 107H174.31V117H81.69ZM139 81.69H149V174.31H139ZM81.69 139H174.31V149H81.69Z',
        dots: 'M177.59 59.41a19 19 0 1 0 38 0a19 19 0 1 0-38 0ZM70.69 168.31a17 17 0 1 0 34 0a17 17 0 1 0-34 0Z',
    },
    full: {
        body: 'M217.05 82.51A100 100 0 1 1 173.49 38.95A7 7 0 0 1 167.12 51.41A86 86 0 1 0 204.59 88.88A7 7 0 0 1 217.05 82.51ZM67.52 148.94A64 64 0 1 1 107.06 188.48A6 6 0 0 1 110.99 177.14A52 52 0 1 0 78.86 145.01A6 6 0 0 1 67.52 148.94ZM106.5 78.15H113.5V177.85H106.5ZM78.15 106.5H177.85V113.5H78.15ZM142.5 78.15H149.5V177.85H142.5ZM78.15 142.5H177.85V149.5H78.15Z',
        dots: 'M178.76 62.24a15 15 0 1 0 30 0a15 15 0 1 0-30 0ZM73.99 169.01a13 13 0 1 0 26 0a13 13 0 1 0-26 0Z',
    },
};

type AppLogoIconProps = SVGAttributes<SVGElement> & {
    variant?: keyof typeof CUTS;
};

/**
 * The DBZuper "Radar Within" mark: a table-grid world on a radar ring, with two orbiting dots.
 * The rings and grid follow currentColor; the dots use the brand's --logo-dot orange.
 */
export default function AppLogoIcon({
    variant = 'small',
    ...props
}: AppLogoIconProps) {
    const cut = CUTS[variant];

    return (
        <svg
            {...props}
            viewBox="0 0 256 256"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
        >
            <path d={cut.body} />
            <path d={cut.dots} className="fill-logo-dot" />
        </svg>
    );
}
