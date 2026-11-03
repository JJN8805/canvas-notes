import type { AddOnModule } from '../types';
import { loadAiSettings } from './config';
import { AiPanel } from './Panel';
import { AiSettings } from './Settings';
import { CardPictureDialog } from './CardPicture';
import { openAddonPanel } from '../store';

void loadAiSettings();

const addon: AddOnModule = {
  Settings: AiSettings,
  Panel: AiPanel,
  panelLabel: 'Assistant',
  panelIcon: 'sparkle',
  cardPictureSources: [{ label: 'Generate with AI', Dialog: CardPictureDialog }],
  commands: ({ pageId }) => (pageId ? [{ id: 'ai-open', icon: 'sparkle', title: 'Open the AI assistant', run: () => openAddonPanel('ai') }] : []),
};

export default addon;
