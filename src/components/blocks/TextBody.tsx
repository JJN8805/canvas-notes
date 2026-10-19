import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import type { StickyBlock, TextBlock } from '../../types';
import { updateBlock } from '../../store/notes';
import { addImages, imageFiles } from '../../store/images';
import { canvasApi, editorRegistry, useCanvas } from '../../store/canvas';
import { useCanvasCtx } from '../editor/context';

/** The rich-text editor of a text box, or of a sticky (which only offers bold, italic and bullets). */
export function TextBody({ block }: { block: TextBlock | StickyBlock }) {
  const sticky = block.type === 'sticky';
  const { pageId } = useCanvasCtx();
  // Handlers are created once with the editor, so read position through a ref.
  const latest = useRef(block);
  latest.current = block;
  const beside = () => ({ x: latest.current.x + latest.current.w + 24, y: latest.current.y });

  const editor = useEditor({
    extensions: [
      StarterKit.configure(
        sticky
          ? {
              heading: false, blockquote: false, codeBlock: false, code: false, strike: false, underline: false,
              link: false, horizontalRule: false, orderedList: false,
            }
          : {
              heading: { levels: [1, 2, 3] },
              link: { openOnClick: false, autolink: true, linkOnPaste: true },
            },
      ),
      Placeholder.configure({ placeholder: sticky ? 'Note…' : 'Type something…' }),
    ],
    content: block.html,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'body prose', 'aria-label': sticky ? 'Sticky note' : 'Text box' },
      // Images pasted or dropped into a text box become their own image boxes beside it.
      handlePaste: (_view, event) => {
        if (sticky) return false;
        const files = imageFiles(event.clipboardData);
        if (!files.length) return false;
        void addImages(pageId, files, beside());
        return true;
      },
      handleDrop: (_view, event) => {
        if (sticky) return false;
        const files = imageFiles((event as DragEvent).dataTransfer);
        if (!files.length) return false;
        const pt = canvasApi.current?.worldPoint((event as DragEvent).clientX, (event as DragEvent).clientY);
        void addImages(pageId, files, pt ?? beside());
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      updateBlock<TextBlock | StickyBlock>(pageId, block.id, (b) => {
        b.html = ed.getHTML();
      }, { history: { key: 'text:' + block.id } });
    },
    onFocus: ({ editor: ed }) => useCanvas.setState({ activeEditor: ed }),
    onBlur: ({ editor: ed }) => {
      window.setTimeout(() => {
        if (!ed.isFocused && useCanvas.getState().activeEditor === ed) useCanvas.setState({ activeEditor: null });
      }, 0);
    },
  });

  // Register for focusing new boxes; unregister on unmount.
  useEffect(() => {
    if (!editor) return;
    editorRegistry.set(block.id, editor);
    return () => {
      if (editorRegistry.get(block.id) === editor) editorRegistry.delete(block.id);
      if (useCanvas.getState().activeEditor === editor) useCanvas.setState({ activeEditor: null });
    };
  }, [editor, block.id]);

  // Content changed from outside the editor (canvas undo/redo, another window).
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.getHTML() !== block.html) {
      editor.commands.setContent(block.html, { emitUpdate: false });
    }
  }, [editor, block.html]);

  return <EditorContent editor={editor} className="text-editor" />;
}
