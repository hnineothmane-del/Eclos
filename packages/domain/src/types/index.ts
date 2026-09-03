export * from './relationship.js';
export * from './goal.js';
export * from './challenge.js';
export * from './memory.js';
export * from './capability.js';
export * from './events.js';
export * from './chat.js';
export * from './billing.js';
export * from './entitlement.js';
export * from './aiContract.js';

// Base application metadata types
export interface AppInfo {
  name: string;
  version: string;
  status: 'ready' | 'initializing';
}

export type PlaceholderType = string;
