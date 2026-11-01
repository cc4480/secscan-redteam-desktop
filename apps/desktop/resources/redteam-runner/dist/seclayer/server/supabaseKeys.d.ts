/** The claims of a JWT, read without verifying the signature; null when the text is not one. */
export declare function jwtClaims(token: string): Record<string, unknown> | null;
export declare function jwtRole(token: string): string | null;
export declare function isServiceRoleToken(token: string): boolean;
/** True for a `*.supabase.co` address whose project name is one of the documentation's. */
export declare function isExampleSupabaseHost(url: string): boolean;
/** The first service_role JWT in the text, found by its decoded role claim, whatever it is stored under. */
export declare function findServiceRoleToken(text: string): string | null;
/**
 * Supabase (URL, public key) pairs in code whose variable names are gone: the URL is the quoted
 * `https://<ref>.supabase.co`, the key is the token that sits next to it (on either side), or, wherever it sits, the
 * anon token whose own `ref` claim names that project. A service_role key, a signed-in user's token and a key issued
 * for another project are never paired.
 */
export declare function findMinifiedSupabasePairs(text: string): Array<{
    url: string;
    key: string;
}>;
/** Table names the app's code reads: `.from("tasks")`. Not `.storage.from("bucket")`, and not `Array.from("…")`. */
export declare function extractTableNames(text: string): string[];
/** Storage bucket names the app's code opens: `supabase.storage.from("avatars")`. */
export declare function extractStorageBucketNames(text: string): string[];
