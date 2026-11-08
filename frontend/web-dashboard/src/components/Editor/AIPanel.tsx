/**
 * AI Panel — invokes AI operations with SSE streaming.
 */

import { useState, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { aiApi, type SSEEvent } from '@/api/ai.api';
import { useQuota } from '@/hooks/useQuota';
import { Button } from '@/components/common/Button';
import { showToast } from '@/components/common/Toast';
import type { AIOperation } from '@/types';

interface AIPanelProps {
  editor: Editor | null;
  onClose: () => void;
}

const operations: Array<{ value: AIOperation; label: string }> = [
  { value: 'grammar', label: 'Fix grammar' },
  { value: 'rephrase', label: 'Rephrase' },
  { value: 'summarize', label: 'Summarize' },
  { value: 'expand', label: 'Expand' },
  { value: 'generate', label: 'Generate' },
];

export function AIPanel({ editor, onClose }: AIPanelProps) {
  const [operation, setOperation] = useState<AIOperation>('rephrase');
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const { quota } = useQuota();

  const handleRun = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selection = editor.state.doc.textBetween(from, to, ' ');

    if (!selection && operation !== 'generate') {
      showToast.error('Please select some text first');
      return;
    }

    setResult('');
    setLoading(true);

    abortRef.current = aiApi.suggestStream(
      {
        operation,
        selection: { text: selection },
        instruction: instruction || undefined,
        sessionId,
      },
      (event: SSEEvent) => {
        if (event.type === 'chunk') {
          const data = event.data as { delta: string };
          setResult((r) => r + data.delta);
        } else if (event.type === 'done') {
          const data = event.data as { session_id: string };
          setSessionId(data.session_id);
          setLoading(false);
        } else if (event.type === 'error') {
          const data = event.data as { code: string; detail: string };
          showToast.error(`AI error: ${data.detail || data.code}`);
          setLoading(false);
        } else if (event.type === 'aborted') {
          setLoading(false);
        }
      },
    );
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const handleInsert = () => {
    if (!editor || !result) return;
    editor.chain().focus().insertContent(result).run();
    showToast.success('Inserted into editor');
    setResult('');
    setSessionId(undefined);
  };

  const handleReplace = () => {
    if (!editor || !result) return;
    editor.chain().focus().deleteSelection().insertContent(result).run();
    showToast.success('Selection replaced');
    setResult('');
    setSessionId(undefined);
  };

  return (
    <aside className="w-96 border-l border-slate-200 bg-white flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">AI Assistant</h2>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-600 rounded"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Quota */}
      {quota && (
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs text-slate-600">
          <div className="flex justify-between">
            <span>{quota.tier} tier</span>
            <span>{quota.remaining.toLocaleString()} / {quota.limit.toLocaleString()} tokens</span>
          </div>
          <div className="mt-1 h-1 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full"
              style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="p-4 space-y-3 border-b border-slate-200">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Operation</label>
          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value as AIOperation)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            disabled={loading}
          >
            {operations.map((op) => (
              <option key={op.value} value={op.value}>{op.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Custom instruction (optional)
          </label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g., Make it more formal"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg resize-none"
            rows={2}
            disabled={loading}
          />
        </div>

        {loading ? (
          <Button variant="danger" onClick={handleCancel} fullWidth>
            Cancel
          </Button>
        ) : (
          <Button onClick={handleRun} fullWidth>
            Run AI
          </Button>
        )}
      </div>

      {/* Result */}
      <div className="flex-1 overflow-y-auto p-4">
        {result ? (
          <>
            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Result</div>
            <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed bg-slate-50 p-3 rounded-lg">
              {result}
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={handleInsert}>Insert</Button>
              <Button size="sm" variant="secondary" onClick={handleReplace}>Replace</Button>
            </div>
          </>
        ) : (
          <div className="text-sm text-slate-400 text-center py-8">
            {loading ? 'Generating…' : 'Select text and click "Run AI" to get suggestions.'}
          </div>
        )}
      </div>
    </aside>
  );
}