/**
 * Drafts page — list + create + filter.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { editorApi } from '@/api/editor.api';
import { Button } from '@/components/common/Button';
import { Loader } from '@/components/common/Loader';
import { Modal } from '@/components/common/Modal';
import { Input } from '@/components/common/Input';
import { showToast } from '@/components/common/Toast';
import { formatRelative, formatNumber } from '@/utils/format';
import type { DraftSummary, ContentType } from '@/types';

type FilterStatus = 'draft' | 'published' | 'archived' | 'all';

export function DraftsPage() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<FilterStatus>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<ContentType>('article');
  const [creating, setCreating] = useState(false);

  const loadDrafts = async () => {
    setLoading(true);
    try {
      const { data } = await editorApi.listDrafts({ status, limit: 50 });
      setDrafts(data);
    } catch {
      showToast.error('Failed to load drafts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      showToast.error('Please enter a title');
      return;
    }
    setCreating(true);
    try {
      const { draft } = await editorApi.createDraft({
        title: newTitle.trim(),
        contentType: newType,
      });
      showToast.success('Draft created');
      navigate(`/editor/${draft.id}`);
    } catch {
      showToast.error('Failed to create draft');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    try {
      await editorApi.deleteDraft(id);
      showToast.success('Draft deleted');
      void loadDrafts();
    } catch {
      showToast.error('Failed to delete');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Drafts</h1>
          <p className="text-slate-600 mt-1">{drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>New draft</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {(['all', 'draft', 'published', 'archived'] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              status === s
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <Loader variant="page" label="Loading drafts…" />
      ) : drafts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-slate-400 mb-4">
            <svg className="mx-auto" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <h3 className="font-semibold text-slate-900 mb-2">No drafts yet</h3>
          <p className="text-sm text-slate-600 mb-4">Start writing to publish your first article or book.</p>
          <Button onClick={() => setShowCreate(true)}>Create your first draft</Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Title</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Type</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Status</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Words</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600 uppercase">Updated</th>
                <th className="text-right px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drafts.map((draft) => (
                <tr key={draft.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <Link to={`/editor/${draft.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                      {draft.title}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 capitalize">{draft.contentType.replace('_', ' ')}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${
                      draft.status === 'published' ? 'bg-success-50 text-success-700' :
                      draft.status === 'draft' ? 'bg-slate-100 text-slate-700' :
                      'bg-warning-50 text-warning-700'
                    }`}>
                      {draft.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{formatNumber(draft.wordCount)}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{formatRelative(draft.updatedAt)}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDelete(draft.id)}
                      className="text-sm text-danger-600 hover:text-danger-700"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create new draft"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={creating}>Create</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="My new draft"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Type</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as ContentType)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            >
              <option value="article">Article</option>
              <option value="book">Book</option>
              <option value="news_post">News post</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}