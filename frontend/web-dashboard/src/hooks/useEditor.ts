/**
 * Editor hook — bridges TipTap editor with the WebSocket + store.
 *
 * Responsibilities:
 *   - Attach to TipTap editor
 *   - Serialize changes into patches
 *   - Send patches via WS (debounced)
 *   - Apply remote patches (from other users)
 *   - Handle version conflicts (rebase or reload)
 */

import { useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '@/store/editor.store';
import { useDebouncedCallback } from './useDebounce';
import type { WSFrame } from '@/types';

// ============================================================
// HOOK
// ============================================================
interface UseEditorOptions {
  editor: Editor | null;
  draftId: string;
  send: (frame: WSFrame) => void;
  connected: boolean;
}

export function useEditor({ editor, draftId, send, connected }: UseEditorOptions) {
  const currentVersion = useEditorStore((s) => s.currentVersion);
  const markDirty = useEditorStore((s) => s.markDirty);
  const draft = useEditorStore((s) => s.draft);
  const lastSerializedRef = useRef<string>('');
  const clientOpIdRef = useRef(0);

  // ============================================================
  // INITIAL CONTENT
  // ============================================================
  useEffect(() => {
    if (!editor || !draft) return;
    if (editor.getHTML() === draft.content) return;

    // Avoid cursor jump: only set content if editor is empty
    if (editor.isEmpty) {
      editor.commands.setContent(draft.content || '');
      lastSerializedRef.current = editor.getHTML();
    }
  }, [editor, draft]);

  // ============================================================
  // SEND PATCH (debounced)
  // ============================================================
  const sendPatch = useDebouncedCallback(
    (html: string) => {
      if (!connected) return;
      if (html === lastSerializedRef.current) return;

      clientOpIdRef.current += 1;
      const clientOpId = `op-${Date.now()}-${clientOpIdRef.current}`;

      // Simple "replace all" op (server-side patch handler supports this)
      send({
        type: 'patch',
        baseVersion: currentVersion,
        ops: [{ type: 'replace_all', content: html }],
        clientOpId,
      });

      lastSerializedRef.current = html;
      markDirty();
    },
    500,
  );

  // ============================================================
  // LISTEN TO EDITOR CHANGES
  // ============================================================
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      sendPatch(editor.getHTML());
    };

    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor, sendPatch]);

  // ============================================================
  // EXPORTED ACTIONS
  // ============================================================
  const forceFlush = useCallback(() => {
    if (!editor) return;
    sendPatch.flush?.();
    sendPatch(editor.getHTML());
  }, [editor, sendPatch]);

  return { forceFlush };
}