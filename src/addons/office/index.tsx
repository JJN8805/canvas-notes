import type { AddOnModule } from '../types';
import { createOfficePage } from '../../store/office';
import { navigate } from '../../lib/route';
import { OFFICE_LABEL, type OfficeApp } from '../../lib/office/app';
import { DocScreen } from '../../components/office/DocScreen';
import { PresentMode } from '../../components/office/PresentMode';
import { ScriptScreen } from '../../components/script/ScriptScreen';
import { SheetScreen } from '../../components/office/SheetScreen';
import { SlidesPanel } from '../../components/office/SlidesPanel';
import { OfficeSettings } from './Settings';
import { openFileAsPage } from '../../components/office/openFile';
import { workspaceOn, isFeatureOn } from '../../lib/features';
import { useFeatures } from '../../store/features';
import { WorkspaceView } from './WorkspaceView';

const ICON = { doc: 'edit', sheet: 'table', slides: 'frame', script: 'book' } as const;
const make = (app: OfficeApp) => () => {
  const page = createOfficePage(app);
  if (page) navigate({ name: 'page', id: page.id });
};

const addon: AddOnModule = {
  Settings: OfficeSettings,
  navItem: { label: 'Workspace', icon: 'pages' },
  navVisible: () => workspaceOn(useFeatures.getState().disabled),
  View: WorkspaceView,
  Overlay: PresentMode,
  pageApps: { doc: { Screen: DocScreen }, script: { Screen: ScriptScreen }, sheet: { Screen: SheetScreen }, slides: { Extras: SlidesPanel } },
  commands: () => [
    ...(['doc', 'sheet', 'slides', 'script'] as const).filter((app) => isFeatureOn(useFeatures.getState().disabled, app)).map((app) => ({ id: `office-new-${app}`, icon: ICON[app], title: `New ${OFFICE_LABEL[app].toLowerCase()}`, run: make(app) })),
    ...(isFeatureOn(useFeatures.getState().disabled, 'doc') ? [{ id: 'office-open-doc', icon: 'edit' as const, title: 'Open a Word file…', run: () => openFileAsPage('doc') }] : []),
    ...(isFeatureOn(useFeatures.getState().disabled, 'sheet') ? [{ id: 'office-open-sheet', icon: 'table' as const, title: 'Open an Excel or CSV file…', run: () => openFileAsPage('sheet') }] : []),
  ],
};

export default addon;
