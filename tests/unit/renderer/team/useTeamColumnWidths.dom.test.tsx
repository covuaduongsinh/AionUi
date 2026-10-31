import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pruneWidths, shiftBetween, useTeamColumnWidths } from '@/renderer/pages/team/columnResize/useTeamColumnWidths';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const pointer = (el: Element, type: string, clientX: number, buttons = 1) =>
  act(() => {
    el.dispatchEvent(new TestPointerEvent(type, { clientX, button: 0, buttons }));
  });

const Harness: React.FC<{ teamId: string; slots: string[]; widths?: number[] }> = ({ teamId, slots, widths }) => {
  const cw = useTeamColumnWidths(teamId, slots, () => 240);
  return (
    <div data-testid='container'>
      {slots.map((id, i) => (
        <div
          key={id}
          data-slot-id={id}
          data-testid={`col-${id}`}
          data-flex={cw.getFlex(id)}
          ref={(el) => {
            if (el) el.getBoundingClientRect = () => ({ width: widths?.[i] ?? 400 }) as DOMRect;
          }}
        >
          {i < slots.length - 1 && (
            <div
              data-testid={`handle-${i}`}
              tabIndex={0}
              onPointerDown={(e) => cw.startDrag(i, e)}
              onKeyDown={(e) => cw.onHandleKeyDown(i, e)}
              onDoubleClick={cw.reset}
            />
          )}
        </div>
      ))}
    </div>
  );
};

const flexOf = (id: string) => screen.getByTestId(`col-${id}`).dataset.flex;

beforeAll(() => {
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
});

beforeEach(() => {
  localStorage.clear();
});

describe('shiftBetween / pruneWidths', () => {
  it('preserves the total and clamps to the minimum', () => {
    expect(shiftBetween(400, 400, 100, 240)).toEqual({ left: 500, right: 300 });
    expect(shiftBetween(400, 400, 1000, 240)).toEqual({ left: 560, right: 240 });
    expect(shiftBetween(400, 400, -1000, 240)).toEqual({ left: 240, right: 560 });
  });

  it('lets the left column keep growing while the strip already overflows', () => {
    expect(shiftBetween(400, 400, 100, 400, true)).toEqual({ left: 500, right: 400 });
    expect(shiftBetween(400, 400, -100, 400, true)).toEqual({ left: 400, right: 400 });
    // shrinking the left column shrinks the scroll area instead of enlarging its neighbour
    expect(shiftBetween(500, 400, -100, 400, true)).toEqual({ left: 400, right: 400 });
    expect(shiftBetween(500, 600, -100, 400, true)).toEqual({ left: 400, right: 600 });
  });

  it('drops widths of removed slots', () => {
    expect(pruneWidths({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });
});

describe('useTeamColumnWidths', () => {
  it('uses the default flex before any drag', () => {
    render(<Harness teamId='t1' slots={['a', 'b']} />);
    expect(flexOf('a')).toBe('1 1 400px');
  });

  it('drag moves width only between the two adjacent columns and persists on release', () => {
    render(<Harness teamId='t1' slots={['a', 'b', 'c']} widths={[400, 400, 400]} />);
    const handle = screen.getByTestId('handle-0');
    pointer(handle, 'pointerdown', 100);
    pointer(handle, 'pointermove', 150);
    pointer(handle, 'pointerup', 150, 0);
    expect(flexOf('a')).toBe('450 0 450px');
    expect(flexOf('b')).toBe('350 0 350px');
    expect(flexOf('c')).toBe('400 0 400px');
    expect(JSON.parse(localStorage.getItem('team-parallel-widths:t1') as string)).toEqual({ a: 450, b: 350, c: 400 });
  });

  it('clamps to the minimum width', () => {
    render(<Harness teamId='t1' slots={['a', 'b']} widths={[400, 400]} />);
    const handle = screen.getByTestId('handle-0');
    pointer(handle, 'pointerdown', 0);
    pointer(handle, 'pointermove', 5000);
    pointer(handle, 'pointerup', 5000, 0);
    expect(flexOf('a')).toBe('560 0 560px');
    expect(flexOf('b')).toBe('240 0 240px');
  });

  it('does not write storage while dragging', () => {
    render(<Harness teamId='t1' slots={['a', 'b']} />);
    const handle = screen.getByTestId('handle-0');
    pointer(handle, 'pointerdown', 0);
    pointer(handle, 'pointermove', 40);
    expect(localStorage.getItem('team-parallel-widths:t1')).toBeNull();
    pointer(handle, 'pointerup', 40, 0);
    expect(localStorage.getItem('team-parallel-widths:t1')).not.toBeNull();
  });

  it('restores saved widths and keeps them per team', () => {
    localStorage.setItem('team-parallel-widths:t1', JSON.stringify({ a: 300, b: 500 }));
    const { unmount } = render(<Harness teamId='t1' slots={['a', 'b']} />);
    expect(flexOf('a')).toBe('300 0 300px');
    unmount();
    render(<Harness teamId='t2' slots={['a', 'b']} />);
    expect(flexOf('a')).toBe('1 1 400px');
  });

  it('prunes widths of removed members and gives new members the default', () => {
    localStorage.setItem('team-parallel-widths:t1', JSON.stringify({ a: 300, b: 500, c: 200 }));
    const { rerender } = render(<Harness teamId='t1' slots={['a', 'b', 'c']} />);
    rerender(<Harness teamId='t1' slots={['a', 'c', 'd']} />);
    expect(flexOf('a')).toBe('300 0 300px');
    expect(flexOf('d')).toBe('1 1 400px');
    expect(JSON.parse(localStorage.getItem('team-parallel-widths:t1') as string)).toEqual({ a: 300, c: 200 });
  });

  it('keyboard arrows nudge the boundary and double click resets', () => {
    render(<Harness teamId='t1' slots={['a', 'b']} widths={[400, 400]} />);
    const handle = screen.getByTestId('handle-0');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(flexOf('a')).toBe('424 0 424px');
    expect(flexOf('b')).toBe('376 0 376px');
    fireEvent.doubleClick(handle);
    expect(flexOf('a')).toBe('1 1 400px');
    expect(localStorage.getItem('team-parallel-widths:t1')).toBeNull();
  });
});
