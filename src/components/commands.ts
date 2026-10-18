// Card commands shared by the selection toolbar, context menu and keyboard shortcuts.

import { getDoc, getUI, setUI, toast } from '../model/store';
import { getIndex } from '../model/index';
import { createShortcut, moveToBoard, placeSynced, setFieldText } from '../model/actions';
import { openPicker } from './Pickers';
import { t } from '../i18n';

export function linkTo(cardId: string) {
  openPicker({
    title: t('Link to…'),
    boardsOnly: false,
    exclude: cardId,
    onPick: (target) => {
      const c = getDoc().cards[cardId];
      if (!c) return;
      const token = `[[@${target}]]`;
      if (c.type === 'image') setFieldText(cardId, 'caption', ((c.data.caption ?? '') + ' ' + token).trim());
      else setFieldText(cardId, 'text', c.text ? c.text.replace(/\s*$/, '') + (c.type === 'note' || c.type === 'document' ? '\n\n' : ' ') + token : token);
      toast(t('Linked to "{t}"', { t: getIndex(getDoc()).title(target) }));
    },
  });
}

export function moveTo(placementIds: string[]) {
  openPicker({ title: t('Move to board…'), boardsOnly: true, exclude: getUI().boardId, onPick: (b) => moveToBoard(placementIds, b) });
}

export function syncedCopy(cardId: string) {
  openPicker({ title: t('Place synced copy on…'), boardsOnly: true, onPick: (b) => placeSynced(cardId, b, 40, 40) });
}

export function addShortcut(boardId: string, x: number, y: number) {
  openPicker({ title: t('Add a shortcut to board…'), boardsOnly: true, exclude: boardId, onPick: (b) => createShortcut(b, boardId, x, y) });
}

export function copyCardLink(cardId: string) {
  const url = `${location.origin}${location.pathname}#/card/${cardId}`;
  void navigator.clipboard?.writeText(url).then(
    () => toast(t('Link copied')),
    () => toast(url),
  );
}

export function showBacklinks(cardId: string) {
  setUI({ focusCard: cardId, rightPanel: 'backlinks' });
}

export function openInGraph(cardId: string) {
  setUI({ focusCard: cardId, rightPanel: 'localGraph' });
}

export function openComments(cardId: string) {
  setUI({ focusCard: cardId, rightPanel: 'comments' });
}

export function openInfo(cardId: string) {
  setUI({ focusCard: cardId, rightPanel: 'info' });
}
