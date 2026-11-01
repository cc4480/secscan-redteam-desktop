export declare function browserEnv(source?: NodeJS.ProcessEnv): Record<string, string>;
export declare function browserLaunchOptions(source?: NodeJS.ProcessEnv): {
    executablePath?: string | undefined;
    headless: boolean;
    args: string[];
    env: Record<string, string>;
};
