import type { Snapshot } from '../types/snapshot';
import { callCommand } from './tauri';

/** 读取快照库（`snapshots.json`，损坏时由 Rust 侧留档后返回空列表） */
export function loadSnapshotsFromDisk(): Promise<Snapshot[]> {
  return callCommand<Snapshot[]>('load_snapshots');
}

/** 原子写回快照库 */
export function saveSnapshotsToDisk(snapshots: readonly Snapshot[]): Promise<void> {
  return callCommand<void>('save_snapshots', { snapshots });
}
