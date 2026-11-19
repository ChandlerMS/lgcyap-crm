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
    root.current?.querySelectorAll<HTMLDetailsElement>('main details').forEach(detail => { detail.open = expanded; });
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
    <button type="button" className="expand-collapse-arrow" aria-label="Expand All" title="Expand All" onClick={() => context.setExpanded(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button>
    <button type="button" className="expand-collapse-arrow" aria-label="Collapse All" title="Collapse All" onClick={() => context.setExpanded(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg></button>
  </div>;
}
