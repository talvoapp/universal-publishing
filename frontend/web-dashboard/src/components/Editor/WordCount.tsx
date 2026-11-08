/**
 * Word count footer.
 */

import type { Editor } from '@tiptap/react';
import { useEditorStore } from '@/store/editor.store';
import { clsx } from 'clsx';

interface WordCountProps {
  editor: Editor | null;
}

export function WordCount({ editor }: WordCountProps) {
  const dirty = useEditorStore((s) => s.dirty);
  const pendingOps = useEditorStore((s) => s.pendingOps);

  if (!editor) return null;

  const characters = editor.storage.characterCount.characters();
  const words = editor.storage.characterCount.words();
  const readTime = Math.max(1, Math.ceil(words / 200));

  return (
    <div className="border-t border-slate-200 bg-white px-6 py-2 flex items-center justify-between text-xs text-slate-500">
      <div className="flex items-center gap-4">
        <span>{words.toLocaleString()} words</span>
        <span>{characters.toLocaleString()} chars</span>
        <span>{readTime} min read</span>
      </div>
      <div className="flex items-center gap-2">
        {pendingOps > 0 && (
          <span className="text-brand-600">{pendingOps} unsaved</span>
        )}
        <span
          className={clsx(
            'w-2 h-2 rounded-full',
            dirty ? 'bg-warning-500' : 'bg-success-500',
          )}
          title={dirty ? 'Unsaved changes' : 'All changes saved'}
        />
      </div>
    </div>
  );
}