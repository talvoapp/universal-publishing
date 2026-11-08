/**
 * Editor page — wrapper that loads the draft then shows the Editor.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { editorApi } from '@/api/editor.api';
import { useEditorStore } from '@/store/editor.store';
import { Editor } from '@/components/Editor/Editor';
import { Loader } from '@/components/common/Loader';
import { showToast } from '@/components/common/Toast';

export function EditorPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const setDraft = useEditorStore((s) => s.setDraft);
  const clear = useEditorStore((s) => s.clear);

  useEffect(() => {
    // No draftId → create a new draft then redirect
    if (!draftId) {
      void (async () => {
        try {
          const { draft } = await editorApi.createDraft({ contentType: 'article' });
          navigate(`/editor/${draft.id}`, { replace: true });
        } catch {
          showToast.error('Failed to create draft');
          navigate('/drafts');
        }
      })();
      return;
    }

    // Load existing draft
    void (async () => {
      try {
        const { draft } = await editorApi.getDraft(draftId);
        setDraft(draft);
        setLoading(false);
      } catch {
        showToast.error('Draft not found');
        navigate('/drafts');
      }
    })();

    return () => {
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  if (loading) {
    return <Loader variant="page" label="Loading draft…" />;
  }

  if (!draftId) {
    return null;
  }

  return (
    <div className="-m-6 h-[calc(100vh-3.5rem)]">
      <Editor draftId={draftId} />
    </div>
  );
}