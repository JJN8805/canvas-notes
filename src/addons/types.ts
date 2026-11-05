/** What an add-on can contribute to the app. An add-on is a module that is only fetched and run once it is switched on in Settings → Add-ons. */
import type { ComponentType } from 'react';
import type { Editor } from '@tiptap/react';
import type { Block } from '../types';
import type { Command } from '../components/nav/commands';
import type { IconName } from '../components/ui/Icon';

export type AddOnId = 'ai' | 'ocr';

export interface BlockAction {
  id: string;
  /** Shown on the box's hover bar. */
  label: string;
  run: () => void | Promise<void>;
}

/** Another way to give a card its picture, offered beside "Add picture". The dialog calls `onPick` with the picture it made. */
export interface CardPictureSource {
  label: string;
  Dialog: ComponentType<{ cardLabel: string; onPick: (file: File) => void; onClose: () => void }>;
}

export interface AddOnModule {
  /** Its section in Settings → Add-ons, shown while it is switched on. */
  Settings: ComponentType;
  /** A side panel opened from a button in the page's header. */
  Panel?: ComponentType<{ pageId: string; onClose: () => void }>;
  panelLabel?: string;
  panelIcon?: IconName;
  /** Extra buttons on a box's hover bar. */
  blockActions?: (block: Block, pageId: string) => BlockAction[];
  /** A sidebar entry in the library that opens this add-on's `View` as a full page. */
  navItem?: { label: string; icon: IconName };
  /** The full-page screen opened by `navItem`. */
  View?: ComponentType;
  /** "Search or ask": called with the words typed in the quick switcher when the user chooses to ask rather than search. */
  askHandler?: (question: string) => void;
  /** Buttons in the text formatting bar, given the text box being edited. */
  FormatTool?: ComponentType<{ editor: Editor }>;
  /** Floating UI that lives outside the page (a card that appears near the text, say), mounted once for the whole app. */
  Overlay?: ComponentType;
  /** Called when space is pressed in an empty text box. Return true if it was used (the space is then not typed). */
  onEmptyTextSpace?: (editor: Editor) => boolean;
  /** Extra ways to get a card's picture. */
  cardPictureSources?: CardPictureSource[];
  /** Extra entries in the command palette. */
  commands?: (ctx: { pageId: string | null }) => Command[];
}

export interface AddOnInfo {
  id: AddOnId;
  name: string;
  description: string;
  /** Where its data goes, in plain words, shown beside the switch. */
  privacy: string;
  load: () => Promise<AddOnModule>;
}
