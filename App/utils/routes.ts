export type AppRoute =
  | { view: 'home'; tab: 'history' | 'workflows'; workflowId: string | null }
  | { view: 'canvas'; workflowId: string }
  | { view: 'run-detail'; runId: string };

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export function parseRoute(location: Pick<Location, 'pathname' | 'search'>): AppRoute {
  const segments = location.pathname.split('/').filter(Boolean).map(decode);

  if (segments[0] === 'workflows' && segments[1]) {
    return { view: 'canvas', workflowId: segments[1] };
  }
  if (segments[0] === 'runs' && segments[1]) {
    return { view: 'run-detail', runId: segments[1] };
  }

  const params = new URLSearchParams(location.search);
  const workflowId = params.get('workflowId') || params.get('workflow');
  if (segments[0] === 'workflows') {
    return { view: 'home', tab: 'workflows', workflowId: null };
  }
  return { view: 'home', tab: 'history', workflowId };
}

export function routePath(route: AppRoute): string {
  if (route.view === 'canvas') {
    return `/workflows/${encodeURIComponent(route.workflowId)}`;
  }
  if (route.view === 'run-detail') {
    return `/runs/${encodeURIComponent(route.runId)}`;
  }
  if (route.tab === 'workflows') return '/workflows';
  if (!route.workflowId) return '/history';
  return `/history?workflowId=${encodeURIComponent(route.workflowId)}`;
}

export function absoluteRouteUrl(route: AppRoute): string {
  return `${window.location.origin}${routePath(route)}`;
}

