'use client';
import { Children, isValidElement, useState, type HTMLAttributes, type ReactNode } from 'react';
function messageText(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child) ? messageText(child.props.children) : typeof child === 'string' || typeof child === 'number' ? String(child) : '').join('|');
}
export default function DismissibleNotice({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  const message = messageText(children);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (dismissed === message) return null;
  return <div {...props} className={`${className} dismissible-notice`}><div>{children}</div><button type="button" className="gold-close" aria-label="Dismiss notification" title="Dismiss notification" onClick={() => setDismissed(message)}>×</button></div>;
}
