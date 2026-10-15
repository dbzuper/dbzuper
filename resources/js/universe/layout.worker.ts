import { computeLayout, type LayoutInput } from './layout';

type Ctx = {
    onmessage:
        | ((
              e: MessageEvent<{ input: LayoutInput; iterations?: number }>,
          ) => void)
        | null;
    postMessage(data: unknown): void;
};
const ctx = self as unknown as Ctx;

ctx.onmessage = (e) => {
    ctx.postMessage(computeLayout(e.data.input, e.data.iterations));
};
