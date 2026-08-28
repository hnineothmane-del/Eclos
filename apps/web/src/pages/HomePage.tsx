import React from 'react';
import type { AppInfo } from '@ai-rival/domain';
import { Placeholder } from '../components/Placeholder';
import { formatTitle } from '../lib/utils';
import { initialUIState } from '../state/placeholder';

export const HomePage: React.FC = () => {
  const appInfo: AppInfo = {
    name: 'AI Rival MVP',
    version: '0.1.0',
    status: 'ready',
  };

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>{formatTitle(appInfo.name)}</h1>
      <p>Status: {appInfo.status}</p>
      <p>UI Initialized: {initialUIState.isReady ? 'Yes' : 'No'}</p>
      <Placeholder message="V1 Repository Foundation Ready" />
    </main>
  );
};
