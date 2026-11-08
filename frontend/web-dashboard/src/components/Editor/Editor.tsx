/**
 * Editor — TipTap wrapper integrated with the WS sync.
 *
 * Receives an initial draft, sets up WS, and renders the editor.
 */

import { useEditor as useTipTapEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { useEffect, useState } from 'react';
import { useEditorStore } from '@/store/editor.store';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useEditor as useSync } from '@/hooks/useEditor';
import { Toolbar } from './Toolbar';
import { WordCount } from './WordCount';
import { AIPanel } from './AIPanel';
import { VersionHistory } from './VersionHistory';

interface EditorProps {
  draftId: string;
}

export function Editor({ draftId }: EditorProps) {
  const draft = useEditorStore((s) => s.draft);
  const handleWsEvent = useEditorStore((s) => s.handleWsEvent);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { connected, send } = useWebSocket({
    draftId,
    onEvent: handleWsEvent,
  });

  const editor = useTipTapEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'bg-slate-900 text-slate-100 p-4 rounded-lg' } },
      }),
      Placeholder.configure({ placeholder: 'Start writing your story…' }),
      CharacterCount,
      Link.configure({ openOnClick: false }),
      Image,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none',
      },
    },
  });

  // Wire up WS sync
  useSync({ editor, draftId, send, connected });

  // Clean up on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!draft) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-slate-500">Loading editor…</div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <Toolbar
          editor={editor}
          onAIToggle={() => setAiPanelOpen((o) => !o)}
          onHistoryToggle={() => setHistoryOpen(true)}
          connected={connected}
        />

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-10">
            <input
              type="text"
              value={draft.title}
              placeholder="Untitled"
              className="w-full text-4xl font-bold bg-transparent border-none outline-none placeholder:text-slate-300 mb-8"
              readOnly
            />
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Word count footer */}
        <WordCount editor={editor} />
      </div>

      {/* AI Panel */}
      {aiPanelOpen && <AIPanel editor={editor} onClose={() => setAiPanelOpen(false)} />}

      {/* Version history drawer */}
      {historyOpen && (
        <VersionHistory
          draftId={draftId}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}