/**
 * Locale dictionary merging and the translation signatures slot registrations are
 * typed against.
 */

/**
 * Locale namespace table. Dictionary owners extend via declaration merging
 * (exactly like {@link SlotMap}, and declared in this entry module for the
 * same lexical-merge reason): the key is the namespace string, the value is
 * the union of its dictionary keys. Register sites declare one of these
 * namespaces (`locale:`), which puts the typed `t` standard seat on the
 * component props.
 */
export interface LocaleNamespaceMap {}

/**
 * Resource protocol (URL scheme) → the value its provider streams. Declared
 * empty here, the zero-dependency merge point; each protocol owner merges its
 * own member (`file`, later `chat`), and `useResource<P>(address)` narrows its
 * value by `P`. The resource service itself lives in `dsh-client-resources`.
 */
export interface ResourceProtocolMap {}

/**
 * Translate a dictionary key with optional `{name}` template params.
 * `K` narrows the accepted keys to the owning namespace's dictionary union
 * (plus the shared common vocabulary where composed).
 */
export type Translate<K extends string = string> =
  (key: K, params?: Record<string, unknown>) => string

/**
 * The shared `common` vocabulary keys as merged by the locale plugin;
 * resolves to `never` in programs without the merge (this package's tests),
 * keeping the union collapse harmless.
 */
export type CommonKeyOf = LocaleNamespaceMap extends { common: infer C } ? C & string : never

/**
 * Key domain of a namespace-bound translate: the namespace's own dictionary
 * union plus the shared common vocabulary (the lookup chain consults common
 * after the namespace misses).
 */
export type LocaleKeysOf<N extends keyof LocaleNamespaceMap & string> =
  (LocaleNamespaceMap[N] & string) | CommonKeyOf

/**
 * Namespace-addressed translate — the developer-facing alias over
 * {@link Translate}: `TranslateNS<'model'>` is the translate function of the
 * `model` namespace (key domain = its dictionary union plus the shared
 * common vocabulary), the exact type of the framework-injected `t` seat and
 * of the locale service's typed `bind`.
 */
export type TranslateNS<N extends keyof LocaleNamespaceMap & string> = Translate<LocaleKeysOf<N>>

/**
 * Dictionary shape for a declared namespace: exactly the keys the namespace
 * merged into {@link LocaleNamespaceMap} — a missing or extra key at a typed
 * registration site is a compile error.
 */
export type LocaleDictOf<N extends keyof LocaleNamespaceMap & string> =
  Record<LocaleNamespaceMap[N] & string, string>

/**
 * Locale share of the composed component props: the framework-injected `t`
 * seat, present exactly on entries whose registration declares `locale:`.
 */
export type PropsLocale<N> = N extends keyof LocaleNamespaceMap & string
  ? {
    /** Translate a dictionary key of the declared namespace (or the shared common vocabulary). */
    t: TranslateNS<N>
  }
  : object
