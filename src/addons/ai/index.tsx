import type { AddOnModule } from '../types';
import { loadAiSettings } from './config';
import { AiPanel } from './Panel';
import { AiSettings } from './Settings';
import { CardPictureDialog } from './CardPicture';
import { InlineAiFormatTool, InlineAiHost } from './InlineAi';
import { ChatView } from './ChatView';
import { askInChat, askMyNotes, openChat } from './chatInbox';
import { openInlineAi } from './inline';
import { currentRoute } from '../../lib/route';
import { openAddonPanel } from '../store';
import { startRag } from './rag/runtime';

void loadAiSettings();
startRag(); // keeps the notes index (for searching by meaning) up to date while this add-on is on

const addon: AddOnModule = {
  Settings: AiSettings,
  Panel: AiPanel,
  panelLabel: 'Assistant',
  panelIcon: 'sparkle',
  cardPictureSources: [{ label: 'Generate with AI', Dialog: CardPictureDialog }],
  // A full-page Chat screen, in the library sidebar, and "Ask AI" in the quick switcher (Ctrl+K).
  navItem: { label: 'Chat', icon: 'chat' },
  View: ChatView,
  askHandler: askInChat,
  FormatTool: InlineAiFormatTool,
  Overlay: InlineAiHost,
  // Space in an empty text box opens "Write with AI" (and types no space), like pressing space on a blank line in Notion.
  onEmptyTextSpace: (editor) => {
    const r = currentRoute();
    if (r.name !== 'page') return false;
    openInlineAi(editor, r.id, true);
    return true;
  },
  commands: ({ pageId }) => [
    { id: 'ai-chat', icon: 'chat', title: 'Open AI chat', run: openChat },
    { id: 'ai-ask-notes', icon: 'search', title: 'Ask my notes…', run: askMyNotes },
    ...(pageId
      ? [
          { id: 'ai-open', icon: 'sparkle' as const, title: 'Open the AI assistant on this page', run: () => openAddonPanel('ai') },
          { id: 'ai-write', icon: 'sparkle' as const, title: 'Write with AI…', run: () => openInlineAi(null, pageId, true) },
        ]
      : []),
  ],
};

export default addon;
