/**
 * Version history drawer.
 */

import { useEffect, useState } from 'react';
import { versionApi } from '@/api/editor.api';
import { formatRelative } from '@/utils/format';
import { showToast } from '@/components/common/Toast';
import { Button } from '@/components/common/Button';
import { Loader } from '@/components/common/Loader';
import type { VersionEntry } from '@/types';

interface VersionHistoryProps {
  draftId: string;
  onClose: () => void;
}

export function VersionHistory({ draftId, onClose }: VersionHistoryProps) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await versionApi.listVersions(draftId, undefined, 50);
        setVersions(data);
      } catch {
        showToast.error('Failed to load versions');
      } finally {
        setLoading(false);
      }
    })();
  }, [draftId]);

  const handleRevert = async (version: number) => {
    if (!confirm(`Revert to version ${version}? This creates a new version.`)) return;
    setReverting(version);
    try {
      await versionApi.revertToVersion(draftId, version);
      showToast.success(`Reverted to version ${version}`);
      onClose();
      window.location.reload(); // reload editor with new content
    } catch {
      showToast.error('Failed to revert');
    } finally {
      setReverting(null);
    }
  };

  return (
    <aside className="w-80 border-l border-slate-200 bg-white flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Version History</h2>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-600 rounded"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6">
            <Loader label="Loading versions…" />
          </div>
        ) : versions.length === 0 ? (
          <div className="p-6 text-sm text-slate-500 text-center">
            No versions yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {versions.map((v) => (
              <li key={v.version} className="px-4 py-3 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-slate-900">
                      Version {v.version}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatRelative(v.createdAt)} · {v.opCount} edits
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRevert(v.version)}
                    loading={reverting === v.version}
                  >
                    Revert
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}