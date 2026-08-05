/// <reference types="vite/client" />

/**
 * Typed env surface. Without these declarations `import.meta.env.VITE_*` is
 * `any`, so a typo in a variable name — the exact class of mistake that left
 * the app pointed at a CORS-less RPC — type-checks cleanly and fails silently
 * at runtime.
 */
interface ImportMetaEnv {
  readonly VITE_ALCHEMY_API_KEY?: string;
  readonly VITE_ARC_RPC_URL?: string;
  readonly VITE_INDEXER_API_URL?: string;
  readonly VITE_REGISTRY_ADDRESS?: string;
  readonly VITE_REGISTRAR_ADDRESS?: string;
  readonly VITE_RESOLVER_ADDRESS?: string;
  readonly VITE_CONTROLLER_ADDRESS?: string;
  readonly VITE_MARKET_ADDRESS?: string;
  readonly VITE_UNIVERSAL_RESOLVER_ADDRESS?: string;
  readonly VITE_REVERSE_REGISTRAR_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
