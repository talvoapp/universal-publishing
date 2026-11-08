/**
 * Publish page — final validation + publishing.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { editorApi } from '@/api/editor.api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/common/Button';
import { Loader } from '@/components/common/Loader';
import { showToast } from '@/components/common/Toast';
import { formatNumber } from '@/utils/format';
import type { Draft } from '@/types';

export function PublishPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!draftId) {
      navigate('/drafts');
      return;
    }
    void (async () => {
      try {
        const { draft } = await editorApi.getDraft(draftId);
        setDraft(draft);
      } catch {
        showToast.error('Draft not found');
        navigate('/drafts');
      } finally {
        setLoading(false);
      }
    })();
  }, [draftId, navigate]);

  const handlePublish = async () => {
    if (!draft) return;
    setPublishing(true);
    try {
      await editorApi.publishDraft(draft.id);
      showToast.success('Published successfully!');
      navigate('/drafts');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <Loader variant="page" label="Loading…" />;
  if (!draft) return null;

  // Validation
  const hasTitle = draft.title && draft.title !== 'Untitled';
  const hasContent = draft.wordCount >= 100;
  const emailVerified = user?.emailVerified ?? false;
  const canPublish = hasTitle && hasContent && emailVerified && draft.status !== 'published';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Publish your work</h1>
        <p className="text-slate-600 mt-1">Review the checklist before publishing.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="font-semibold text-slate-900">{draft.title}</h2>
        <div className="text-sm text-slate-600">
          {formatNumber(draft.wordCount)} words · {draft.readTimeMinutes} min read · {draft.language}
        </div>

        <div className="border-t border-slate-200 pt-4 space-y-3">
          <ChecklistItem
            passed={hasTitle}
            label="Has title"
            hint={hasTitle ? undefined : 'Give your draft a title'}
          />
          <ChecklistItem
            passed={hasContent}
            label="At least 100 words"
            hint={hasContent ? undefined : `Currently ${draft.wordCount} words`}
          />
          <ChecklistItem
            passed={emailVerified}
            label="Email verified"
            hint={emailVerified ? undefined : 'Verify your email in settings'}
          />
          <ChecklistItem
            passed={draft.status !== 'published'}
            label="Not already published"
            hint={draft.status === 'published' ? 'Already published' : undefined}
          />
        </div>

        <div className="pt-4 flex gap-3">
          <Button variant="secondary" onClick={() => navigate(`/editor/${draft.id}`)}>
            Back to editor
          </Button>
          <Button
            onClick={handlePublish}
            loading={publishing}
            disabled={!canPublish}
            fullWidth
          >
            Publish now
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({ passed, label, hint }: { passed: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
        passed ? 'bg-success-500 text-white' : 'bg-slate-200 text-slate-400'
      }`}>
        {passed ? '✓' : '○'}
      </div>
      <div>
        <div className={`text-sm font-medium ${passed ? 'text-slate-900' : 'text-slate-600'}`}>{label}</div>
        {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}