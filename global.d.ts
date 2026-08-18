/**
 * Ambient module declarations.
 *
 * NativeWind's stylesheet is imported for its side effect in `app/_layout.tsx`;
 * TypeScript needs to be told that a `.css` import is a module.
 */

declare module '*.css';
