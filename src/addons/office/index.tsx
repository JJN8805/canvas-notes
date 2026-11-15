import type { AddOnModule } from '../types';
import { createOfficePage } from '../../store/office';
import { navigate } from '../../lib/route';
import { OFFICE_LABEL, type OfficeApp } from '../../lib/office/app';
import { DocScreen } from '../../components/office/DocScreen';
import { PresentMode } from '../../components/office/PresentMode';
import { SheetScreen } from '../../components/office/SheetScreen';
import { SlidesPanel } from '../../components/office/SlidesPanel';
import { OfficeSettings } from './Settings';
import { WorkspaceView } from './WorkspaceView';

const ICON = { doc: 'edit', sheet: 'table', slides: 'frame' } as const;
const make = (app: OfficeApp) => () => {
  const page = createOfficePage(app);
  if (page) navigate({ name: 'page', id: page.id });
};

const addon: AddOnModule = {
  Settings: OfficeSettings,
  navItem: { label: 'Workspace', icon: 'pages' },
  View: WorkspaceView,
  Overlay: PresentMode,
  pageApps: { doc: { Screen: DocScreen }, sheet: { Screen: SheetScreen }, slides: { Extras: SlidesPanel } },
  commands: () => (['doc', 'sheet', 'slides'] as const).map((app) => ({ id: `office-new-${app}`, icon: ICON[app], title: `New ${OFFICE_LABEL[app].toLowerCase()}`, run: make(app) })),
};

export default addon;
