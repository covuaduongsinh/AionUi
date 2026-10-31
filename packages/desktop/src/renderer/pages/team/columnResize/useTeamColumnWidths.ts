/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

/** Column widths (px) keyed by assistant slot_id. */
export type ColumnWidths = Record<string, number>;

export const DEFAULT_COLUMN_BASIS = 400;
export const KEYBOARD_STEP = 24;

const storageKey = (team_id: string): string => `team-parallel-widths:${team_id}`;

export const readColumnWidths = (team_id: string): ColumnWidths => {
  try {
    const raw = localStorage.getItem(storageKey(team_id));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result: ColumnWidths = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
};

const writeColumnWidths = (team_id: string, widths: ColumnWidths): void => {
  try {
    if (Object.keys(widths).length === 0) localStorage.removeItem(storageKey(team_id));
    else localStorage.setItem(storageKey(team_id), JSON.stringify(widths));
  } catch {
    // storage unavailable — widths still apply in memory
  }
};

/** Keep only slots that still exist, so removed members do not linger in storage. */
export const pruneWidths = (widths: ColumnWidths, slotIds: string[]): ColumnWidths => {
  const result: ColumnWidths = {};
  for (const id of slotIds) {
    if (widths[id] !== undefined) result[id] = widths[id];
  }
  return result;
};

/**
 * Move `delta` px from the right neighbour to the left one (negative = opposite).
 * Only the two adjacent columns change and their total is preserved; each is clamped to `minWidth`.
 */
export const shiftBetween = (
  leftWidth: number,
  rightWidth: number,
  delta: number,
  minWidth: number,
  overflowing = false
) => {
  const total = leftWidth + rightWidth;
  if (overflowing) {
    // The strip already scrolls horizontally, so the left column may keep growing past the point
    // where its neighbour hits the floor; the extra width simply lengthens the scroll area.
    const left = Math.max(minWidth, leftWidth + delta);
    // Never hand width back to the right column: shrinking the left one shrinks the scroll area.
    return { left, right: Math.min(rightWidth, Math.max(minWidth, total - left)) };
  }
  const left = Math.max(minWidth, Math.min(total - minWidth, leftWidth + delta));
  return { left, right: total - left };
};

type UseTeamColumnWidthsResult = {
  /** CSS `flex` value for a column. */
  getFlex: (slotId: string) => string;
  /** True while a pointer drag is in progress. */
  isDragging: boolean;
  startDrag: (index: number, e: ReactPointerEvent<HTMLElement>) => void;
  onHandleKeyDown: (index: number, e: ReactKeyboardEvent<HTMLElement>) => void;
  reset: () => void;
};

/**
 * Per-team, per-column widths for the parallel view. The handle between column `index`
 * and `index + 1` is expected to be rendered inside column `index`, whose siblings are
 * all columns carrying a `data-slot-id` attribute.
 */
export function useTeamColumnWidths(
  team_id: string,
  slotIds: string[],
  getMinWidth: () => number
): UseTeamColumnWidthsResult {
  const [widths, setWidths] = useState<ColumnWidths>(() => readColumnWidths(team_id));
  const [isDragging, setIsDragging] = useState(false);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const slotIdsRef = useRef(slotIds);
  slotIdsRef.current = slotIds;
  const minWidthRef = useRef(getMinWidth);
  minWidthRef.current = getMinWidth;
  const cleanupRef = useRef<(() => void) | null>(null);

  // Reload when switching teams.
  const teamRef = useRef(team_id);
  useEffect(() => {
    if (teamRef.current === team_id) return;
    teamRef.current = team_id;
    setWidths(readColumnWidths(team_id));
  }, [team_id]);

  // Drop widths of members that left the team (new members simply use the default basis).
  const slotKey = slotIds.join('|');
  useEffect(() => {
    const pruned = pruneWidths(widthsRef.current, slotIdsRef.current);
    if (Object.keys(pruned).length !== Object.keys(widthsRef.current).length) {
      setWidths(pruned);
      writeColumnWidths(team_id, pruned);
    }
  }, [slotKey, team_id]);

  useEffect(() => () => cleanupRef.current?.(), []);

  /** Snapshot the real rendered widths of all columns so unsized ones join the px model. */
  const measure = (columns: HTMLElement[]): ColumnWidths => {
    const result: ColumnWidths = {};
    for (const col of columns) {
      const id = col.dataset.slotId;
      if (id) result[id] = col.getBoundingClientRect().width || DEFAULT_COLUMN_BASIS;
    }
    return result;
  };

  const startDrag = useCallback(
    (index: number, e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' && e.button !== 0) return;
      e.preventDefault();
      const handle = e.currentTarget;
      const column = handle.parentElement;
      const container = column?.parentElement;
      if (!column || !container) return;
      const columns = Array.from(container.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
      const leftId = slotIdsRef.current[index];
      const rightId = slotIdsRef.current[index + 1];
      if (!leftId || !rightId) return;

      const base = measure(columns);
      const overflowing = container.scrollWidth > container.clientWidth + 1;
      const startX = e.clientX;
      const dir = getComputedStyle(handle).direction === 'rtl' ? -1 : 1;
      const startLeft = base[leftId] ?? DEFAULT_COLUMN_BASIS;
      const startRight = base[rightId] ?? DEFAULT_COLUMN_BASIS;
      const pointerId = e.pointerId;
      let latest: ColumnWidths = base;
      let rafId: number | null = null;
      let pending: number | null = null;
      let done = false;

      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      setIsDragging(true);

      const apply = () => {
        rafId = null;
        if (pending === null) return;
        const { left, right } = shiftBetween(startLeft, startRight, pending, minWidthRef.current(), overflowing);
        latest = { ...base, [leftId]: left, [rightId]: right };
        setWidths(latest);
      };

      const finish = () => {
        if (done) return;
        done = true;
        if (rafId !== null) cancelAnimationFrame(rafId);
        apply();
        writeColumnWidths(team_id, pruneWidths(latest, slotIdsRef.current));
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        try {
          if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
        } catch {
          // ignore
        }
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        handle.removeEventListener('lostpointercapture', finish);
        window.removeEventListener('blur', finish);
        cleanupRef.current = null;
        setIsDragging(false);
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.buttons === 0 && ev.pointerType !== 'touch') {
          finish();
          return;
        }
        pending = (ev.clientX - startX) * dir;
        if (rafId === null) rafId = requestAnimationFrame(apply);
      };

      try {
        handle.setPointerCapture(pointerId);
      } catch {
        // fall through; events still reach the handle while the pointer is over it
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', finish);
      window.addEventListener('blur', finish);
      cleanupRef.current = finish;
    },
    [team_id]
  );

  const onHandleKeyDown = useCallback(
    (index: number, e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const column = e.currentTarget.parentElement;
      const container = column?.parentElement;
      const leftId = slotIdsRef.current[index];
      const rightId = slotIdsRef.current[index + 1];
      if (!container || !leftId || !rightId) return;
      e.preventDefault();
      const columns = Array.from(container.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
      const base = measure(columns);
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
      // ArrowRight moves the boundary to the right in physical terms.
      const physical = e.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP;
      const { left, right } = shiftBetween(
        base[leftId] ?? DEFAULT_COLUMN_BASIS,
        base[rightId] ?? DEFAULT_COLUMN_BASIS,
        rtl ? -physical : physical,
        minWidthRef.current(),
        container.scrollWidth > container.clientWidth + 1
      );
      const next = { ...base, [leftId]: left, [rightId]: right };
      setWidths(next);
      writeColumnWidths(team_id, pruneWidths(next, slotIdsRef.current));
    },
    [team_id]
  );

  const reset = useCallback(() => {
    setWidths({});
    writeColumnWidths(team_id, {});
  }, [team_id]);

  const getFlex = useCallback(
    (slotId: string): string => {
      const w = widths[slotId];
      return w ? `${w} 0 ${w}px` : `1 1 ${DEFAULT_COLUMN_BASIS}px`;
    },
    [widths]
  );

  return { getFlex, isDragging, startDrag, onHandleKeyDown, reset };
}
