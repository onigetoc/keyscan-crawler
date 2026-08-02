import { isInsideScope, type ScopeMode } from '../utils/url.js';

/**
 * Create a scope filter function bound to the seed and scope mode.
 * scopeRoot overrides the dir boundary (from smart detection).
 */
export function createScopeFilter(seed: string, scope: ScopeMode, scopeRoot?: string) {
  return (url: string): boolean => isInsideScope(url, seed, scope, scopeRoot);
}
