/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onReset: () => void;
};

/** Vertical drag handle straddling the boundary at the end edge of a parallel-view column. */
const TeamColumnResizeHandle: React.FC<Props> = ({ onPointerDown, onKeyDown, onReset }) => {
  const { t } = useTranslation();
  return (
    <div
      role='separator'
      aria-orientation='vertical'
      aria-label={t('team.view.resizeColumns')}
      tabIndex={0}
      data-testid='team-column-resize-handle'
      className='group absolute top-0 bottom-0 -end-4px z-20 w-8px cursor-col-resize flex justify-center touch-none outline-none'
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    >
      <span className='pointer-events-none block h-full w-1px bg-[color:var(--border-base)] transition-all duration-150 group-hover:w-3px group-hover:bg-aou-6 group-focus-visible:w-3px group-focus-visible:bg-aou-6 group-active:w-3px group-active:bg-aou-6' />
    </div>
  );
};

export default TeamColumnResizeHandle;
