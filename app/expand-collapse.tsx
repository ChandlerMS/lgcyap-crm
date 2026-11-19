'use client';
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

type Handler = (expanded: boolean) => void;
type Expansion = { register: (handler: Handler) => () => void; setExpanded: Handler };
const Context = createContext<Expansion | null>(null);

// One coordinator per page tree. React disclosures register their state setters; native disclosures live in the same scope.
export function ExpandCollapseProvider({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const handlers = useRef(new Set<Handler>());
  const register = useCallback((handler: Handler) => {
    handlers.current.add(handler);
    return () => { handlers.current.delete(handler); };
  }, []);
  const setExpanded = useCallback((expanded: boolean) => {
    handlers.current.forEach(handler => handler(expanded));
    root.current?.querySelectorAll('main details').forEach(detail => { detail.open = expanded; });
  }, []);
  return <Context.Provider value={{ register, setExpanded }}><div ref={root} className="expansion-scope">{children}</div></Context.Provider>;
}

export function useExpandCollapse(handler: Handler) {
  const register = useContext(Context)?.register;
  const current = useRef(handler);
  useEffect(() => { current.current = handler; });
  useEffect(() => register?.(expanded => current.current(expanded)), [register]);
}

export function ExpandCollapseControls() {
  const context = useContext(Context);
  if (!context) return null;
  return <div className="expand-collapse-controls" role="group" aria-label="Page sections">
    <button type="button" className="btn btn-quiet" onClick={() => context.setExpanded(true)}>Expand All</button>
    <button type="button" className="btn btn-quiet" onClick={() => context.setExpanded(false)}>Collapse All</button>
  </div>;
}
