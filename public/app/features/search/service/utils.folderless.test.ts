import { queryResultToViewItem } from './utils';
import { type DashboardQueryResult, type SearchResultMeta } from './types';
import { type DataFrameView } from '@grafana/data';

describe('queryResultToViewItem folderless dashboards', () => {
  const makeQueryResult = (overrides: Partial<DashboardQueryResult> = {}): DashboardQueryResult => ({
    kind: 'dashboard',
    uid: 'dashboard-uid',
    name: 'Dashboard',
    url: '/d/dashboard-uid/dashboard',
    description: '',
    tags: [],
    location: 'dashboard-uid',
    ds_uid: [],
    panel_type: '',
    score: 0,
    explain: {},
    ...overrides,
  });

  const makeView = (locationInfo: SearchResultMeta['locationInfo']): DataFrameView<DashboardQueryResult> =>
    ({
      dataFrame: { fields: [], length: 0, meta: { custom: { locationInfo } } },
    }) as DataFrameView<DashboardQueryResult>;

  it('does not assign a dashboard as its own parent', () => {
    const item = queryResultToViewItem(
      makeQueryResult(),
      makeView({
        'dashboard-uid': { kind: 'folder', name: 'Dashboard', url: '/dashboards/f/dashboard-uid' },
      })
    );

    expect(item.parentUID).toBeUndefined();
    expect(item.parentTitle).toBeUndefined();
  });

  it('still assigns a real folder as the parent', () => {
    const item = queryResultToViewItem(
      makeQueryResult({ location: 'real-folder' }),
      makeView({
        'real-folder': { kind: 'folder', name: 'Real folder', url: '/dashboards/f/real-folder' },
      })
    );

    expect(item.parentUID).toBe('real-folder');
    expect(item.parentTitle).toBe('Real folder');
  });
});
