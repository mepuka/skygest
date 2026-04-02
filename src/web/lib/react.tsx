"use client";

import type { Atom } from "effect/unstable/reactivity";
import { AtomRegistry } from "effect/unstable/reactivity";
import * as React from "react";

const defaultRegistry = AtomRegistry.make({ defaultIdleTTL: 400 });

const RegistryContext = React.createContext<AtomRegistry.AtomRegistry>(defaultRegistry);

// ---------------------------------------------------------------------------
// RegistryProvider
// ---------------------------------------------------------------------------

export function RegistryProvider({ children }: { readonly children: React.ReactNode }) {
  const ref = React.useRef<{
    registry: AtomRegistry.AtomRegistry;
    timeout?: ReturnType<typeof setTimeout>;
  } | null>(null);

  if (ref.current === null) {
    ref.current = { registry: AtomRegistry.make({ defaultIdleTTL: 400 }) };
  }

  React.useEffect(() => {
    if (ref.current?.timeout !== undefined) {
      clearTimeout(ref.current.timeout);
    }
    return () => {
      ref.current!.timeout = setTimeout(() => {
        ref.current?.registry.dispose();
        ref.current = null;
      }, 500);
    };
  }, []);

  return (
    <RegistryContext.Provider value={ref.current.registry}>
      {children}
    </RegistryContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// useAtomValue
// ---------------------------------------------------------------------------

function makeStore<A>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<A>) {
  return {
    subscribe(f: () => void) {
      return registry.subscribe(atom, f);
    },
    snapshot() {
      return registry.get(atom);
    }
  };
}

export function useAtomValue<A>(atom: Atom.Atom<A>): A {
  const registry = React.useContext(RegistryContext);
  const store = React.useMemo(() => makeStore(registry, atom), [registry, atom]);
  return React.useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
