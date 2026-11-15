import { navigate } from '../../lib/route';
import { importOfficeFile } from '../../store/office';
import { toast } from '../../store/ui';

const ACCEPT = { doc: '.docx', sheet: '.xlsx,.csv,.tsv' } as const;

/** Ask for a file with the system picker, make a page of it and open it. Says so when it can't be read. */
export function openFileAsPage(kind: 'doc' | 'sheet'): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT[kind];
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const page = await importOfficeFile(file);
      navigate({ name: 'page', id: page.id });
      toast(`Opened “${page.title}”`);
    } catch (e) {
      toast(`Couldn’t open that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  input.click();
}
