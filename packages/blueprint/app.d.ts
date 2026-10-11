export type PageModule = () => Promise<{ default: string; html: string }>;

/** Render the blueprint app into `el`, loading pages from `import.meta.glob`. */
export declare function mount(el: HTMLElement, pages: Record<string, PageModule>): void;

export declare function BlueprintApp(props: { pages: Record<string, PageModule> }): unknown;
