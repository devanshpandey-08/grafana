import { type ManagedBy } from '@grafana/api-clients/rtkq/dashboard/v0alpha1';
import { type DataFrame, type DataFrameView, type IconName, fuzzySearch } from '@grafana/data';
import { type DashboardViewItemWithUIItems } from 'app/features/browse-dashboards/types';
import { isSharedWithMe, isVirtualStarredFolder, isVirtualTeamFolder } from 'app/features/browse-dashboards/utils/dashboards';
import { getDashboardSrv } from 'app/features/dashboard/services/DashboardSrv';
import { type DashboardDataDTO } from 'app/types/dashboard';
import { AnnoKeyFolder, AnnoKeyUpdatedBy, type ManagerKind, type ResourceList } from '../../apiserver/types';
import { isRootFolderUID } from '../constants';
import { type DashboardViewItem, type DashboardViewItemKind } from '../types';
import { type DashboardQueryResult, type SearchQuery, type SearchResultMeta } from './types';
import { type SearchHit } from './unified';

export const DELETED_BY_REMOVED = '\u0000__grafana_deleted_account__\u0000';
export const DELETED_BY_UNKNOWN = '\u0000__grafana_unknown_account__\u0000';

export function formatDeletedByDisplayValue(rawValue: unknown, t: (key: string, defaultValue: string) => string): string {
  if (rawValue === DELETED_BY_REMOVED) return t('search.results-table.deleted-by-removed', 'Deleted account');
  if (typeof rawValue === 'string' && rawValue) return rawValue;
  return '-';
}

export async function replaceCurrentFolderQuery(query: SearchQuery): Promise<SearchQuery> {
  if (query.query && query.query.indexOf('folder:current') >= 0) {
    query = { ...query, location: await getCurrentFolderUID(), query: query.query.replace('folder:current', '').trim() };
    if (!query.query?.length) query.query = '*';
  }
  return Promise.resolve(query);
}

async function getCurrentFolderUID(): Promise<string | undefined> {
  try {
    let dash = getDashboardSrv().getCurrent();
    if (!dash) {
      await delay(500);
      dash = getDashboardSrv().getCurrent();
    }
    return Promise.resolve(dash?.meta?.folderUid);
  } catch (e) {
    console.error(e);
  }
  return undefined;
}

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function getIconForKind(kind: string, isOpen?: boolean): IconName {
  if (kind === 'dashboard') return 'apps';
  if (kind === 'folder') return isOpen ? 'folder-open' : 'folder';
  if (kind === 'sharedwithme') return 'users-alt';
  return 'question-circle';
}

export function getIconForItem(item: DashboardViewItemWithUIItems, isOpen?: boolean): IconName {
  if (item && isSharedWithMe(item.uid)) return 'user-arrows';
  if (item && isVirtualStarredFolder(item.uid)) return 'favorite';
  if (item && isVirtualTeamFolder(item.uid)) return 'users-alt';
  return getIconForKind(item.kind, isOpen);
}

function parseKindString(kind: string): DashboardViewItemKind {
  switch (kind) {
    case 'dashboard':
    case 'folder':
    case 'panel':
      return kind;
    default:
      return 'dashboard';
  }
}

function isSearchResultMeta(obj: unknown): obj is SearchResultMeta {
  return obj !== null && typeof obj === 'object' && 'locationInfo' in obj;
}

export function extractManagerKind(managedBy?: ManagedBy | ManagerKind): ManagerKind | undefined {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return typeof managedBy === 'string' ? managedBy : (managedBy?.kind as ManagerKind);
}

export function queryResultToViewItem(item: DashboardQueryResult, view?: DataFrameView<DashboardQueryResult>): DashboardViewItem {
  const customMeta = view?.dataFrame.meta?.custom;
  const meta: SearchResultMeta | undefined = isSearchResultMeta(customMeta) ? customMeta : undefined;
  const managedByStr = extractManagerKind(item.managedBy);
  const viewItem: DashboardViewItem = {
    kind: parseKindString(item.kind), uid: item.uid, title: item.name, description: item.description,
    url: item.url, tags: item.tags ?? [], managedBy: managedByStr,
  };
  const sortFieldName = meta?.sortBy;
  if (sortFieldName) {
    const sortFieldValue = item[sortFieldName];
    if (typeof sortFieldValue === 'string' || typeof sortFieldValue === 'number') {
      viewItem.sortMetaName = sortFieldName;
      viewItem.sortMeta = sortFieldValue;
    }
  }
  if (item.location) {
    const ancestors = item.location.split('/');
    const parentUid = ancestors[ancestors.length - 1];
    const parentInfo = meta?.locationInfo[parentUid];
    // Folderless Git Sync can expose a dashboard UID as its location. Never make a dashboard
    // its own parent, otherwise the dashboards list tries to fetch /folders/<dashboard-uid>.
    if (parentInfo && !(viewItem.kind === 'dashboard' && parentUid === viewItem.uid)) {
      viewItem.parentTitle = parentInfo.name;
      viewItem.parentKind = parentInfo.kind;
      viewItem.parentUID = parentUid;
    }
  }
  return viewItem;
}

export function resourceToSearchResult(resource: ResourceList<DashboardDataDTO>, deletedByDisplayMap?: Map<string, string>): SearchHit[] {
  return resource.items.map((item) => {
    const field: Record<string, string | number> = {};
    if (item.metadata.deletionTimestamp) field.deletionTimestamp = item.metadata.deletionTimestamp;
    const deletedByUid = item.metadata.annotations?.[AnnoKeyUpdatedBy];
    if (deletedByUid) field.deletedBy = deletedByDisplayMap?.get(deletedByUid) ?? DELETED_BY_UNKNOWN;
    const folderAnno = item?.metadata?.annotations?.[AnnoKeyFolder] ?? '';
    const folder = isRootFolderUID(folderAnno) ? 'general' : folderAnno;
    return { resource: 'dashboards', name: item.metadata.name, title: item.spec?.title, folder, tags: item.spec?.tags || [], field, url: '' };
  });
}

export function filterSearchResults(results: SearchHit[], query: { query?: string; tag?: string[]; sort?: string }): SearchHit[] {
  let filtered = results;
  if ((query.query && query.query.trim() !== '' && query.query !== '*') || (query.tag && query.tag.length > 0)) {
    const searchString = query.query || query.tag?.join(',') || '';
    const haystack = results.map((hit) => `${hit.title},${hit.tags.join(',')}`);
    const indices = fuzzySearch(haystack, searchString);
    filtered = indices.map((index) => results[index]);
  }
  if (query.sort) {
    if (query.sort === 'deleted-asc' || query.sort === 'deleted-desc') {
      const mult = query.sort === 'deleted-desc' ? -1 : 1;
      filtered.sort((a, b) => {
        const timestampA = a.field.deletionTimestamp;
        const timestampB = b.field.deletionTimestamp;
        if (typeof timestampA !== 'string' && typeof timestampB !== 'string') return 0;
        if (typeof timestampA !== 'string') return 1;
        if (typeof timestampB !== 'string') return -1;
        return mult * (Date.parse(timestampA) - Date.parse(timestampB));
      });
    } else if (query.sort === 'deletedby-asc' || query.sort === 'deletedby-desc') {
      const collator = new Intl.Collator();
      const mult = query.sort === 'deletedby-desc' ? -1 : 1;
      const isSortable = (v: string | number | undefined): v is string => typeof v === 'string' && v !== DELETED_BY_REMOVED && v !== DELETED_BY_UNKNOWN;
      filtered.sort((a, b) => {
        const byA = a.field.deletedBy;
        const byB = b.field.deletedBy;
        const sortableA = isSortable(byA);
        const sortableB = isSortable(byB);
        if (!sortableA && !sortableB) return 0;
        if (!sortableA) return 1;
        if (!sortableB) return -1;
        return mult * collator.compare(byA, byB);
      });
    } else {
      const collator = new Intl.Collator();
      const mult = query.sort === 'alpha-desc' ? -1 : 1;
      filtered.sort((a, b) => mult * collator.compare(a.title, b.title));
    }
  }
  return filtered;
}

export function appendFrame(target: DataFrame, frame: DataFrame): void {
  const existingLength = target.length;
  const newLength = existingLength + frame.length;
  for (const f of frame.fields) {
    if (!target.fields.find((vf) => vf.name === f.name)) {
      target.fields.push({ ...f, values: new Array(existingLength).fill(null).concat(f.values) });
    }
  }
  for (const f of frame.fields) {
    const field = target.fields.find((vf) => vf.name === f.name);
    if (field && field.values.length === existingLength) field.values.push(...f.values);
  }
  for (const field of target.fields) {
    while (field.values.length < newLength) field.values.push(null);
  }
  target.length = newLength;
}
