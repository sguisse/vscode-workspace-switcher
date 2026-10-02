export type ItemType = 'opened' | 'recent' | 'group';

export interface WorkspaceRecord {
  path: string;
  name?: string;
  pid?: number;
  lastActiveTimestamp: number;
}
