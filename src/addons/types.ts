/** What an add-on can contribute to the app. An add-on is a module that is only fetched and run once it is switched on in Settings → Add-ons. */
import type { ComponentType } from 'react';
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
