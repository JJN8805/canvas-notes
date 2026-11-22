/**
 * "Today, everywhere": for every workspace, today's journal page, the to-dos still open and the pages touched most recently, from all the
 * pages at once. Pure: the caller reads every page (they are not all in memory, only the open workspace is).
 */
import type { Page } from '../types';
import { cleanDate, isArchived, kindOf } from './pages';
import { htmlToText } from './pageText';
import { listWorkspaces, workspaceOf, type WorkspaceInfo } from './workspaces';
import type { Group } from '../types';

export interface OpenTodo {
  pageId: string;
  page: string;
  text: string;
}
export interface DeskToday {
  workspace: WorkspaceInfo;
  /** Today's journal page, if the day has been started, with its first words. */
  journal: { pageId: string; snippet: string } | null;
  todos: OpenTodo[];
  /** How many open to-dos there are in all (the list is cut). */
  todoCount: number;
  recent: { pageId: string; title: string }[];
}

const MAX_TODOS = 8;
const MAX_RECENT = 3;

export function todayEverywhere(pages: readonly Page[], groupRows: readonly Group[], mainName: string, today: string): DeskToday[] {
  return listWorkspaces(groupRows, mainName).map((workspace) => {
    const mine = pages.filter((p) => kindOf(p) !== 'template' && !isArchived(p) && workspaceOf(p) === workspace.id);
    const day = mine.find((p) => cleanDate(p.dailyDate) === today) ?? null;
    const todos: OpenTodo[] = [];
    let todoCount = 0;
    for (const p of [...mine].sort((a, b) => b.updated - a.updated)) {
      for (const b of p.blocks) {
        if (b.type !== 'checklist') continue;
        for (const i of b.items) {
          if (i.done || !i.text.trim()) continue;
          todoCount++;
          if (todos.length < MAX_TODOS) todos.push({ pageId: p.id, page: p.title.trim() || 'Untitled', text: i.text.trim() });
        }
      }
    }
    const snippet = day
      ? day.blocks
          .map((b) => (b.type === 'note' && b.style !== 'code' ? htmlToText(b.html) : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
      : '';
    return {
      workspace,
      journal: day ? { pageId: day.id, snippet } : null,
      todos,
      todoCount,
      recent: mine
        .filter((p) => p.id !== day?.id)
        .sort((a, b) => b.updated - a.updated)
        .slice(0, MAX_RECENT)
        .map((p) => ({ pageId: p.id, title: p.title.trim() || 'Untitled' })),
    };
  });
}
