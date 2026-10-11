// Ported from Auraxis (https://github.com/yth1120/Auraxis-Agent), MIT License,
// Copyright (c) 2026 Auraxis Contributors. See THIRD_PARTY_NOTICES.md.
// Adapted to this app's six stops and compact rail (14px thumb, 16px stops).
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThinkingDepthSelector } from './ThinkingDepthSelector';

const LABELS = {
  fast: 'Fast',
  light: 'Light',
  balanced: 'Balanced',
  medium: 'Medium',
  deep: 'Deep',
  smart: 'Smart',
};

function mockTrackRect(track: HTMLElement, width = 200) {
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: 24,
    width,
    height: 24,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ThinkingDepthSelector', () => {
  it('renders a slider with the current level, label, ends and recommendation', () => {
    render(
      <ThinkingDepthSelector
        value="medium"
        labels={LABELS}
        ariaLabel="Effort"
        title="Effort"
        recommended="medium"
        description="Balanced depth for most tasks."
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Effort' });
    expect(slider.getAttribute('aria-valuenow')).toBe('3');
    expect(slider.getAttribute('aria-valuetext')).toBe('Medium');
    expect(screen.getByText('Faster')).toBeDefined();
    expect(screen.getByText('Smarter')).toBeDefined();
    expect(screen.getByText('Recommended')).toBeDefined();
    expect(screen.getByText('Balanced depth for most tasks.')).toBeDefined();
  });

  it('moves to the next level with ArrowRight', async () => {
    const onChange = vi.fn();
    render(<ThinkingDepthSelector value="fast" labels={LABELS} ariaLabel="Effort" title="Effort" onChange={onChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(onChange).toHaveBeenCalledWith('light');
    expect(slider.getAttribute('aria-valuenow')).toBe('1');
  });

  it('selects a level when its dot is clicked', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ThinkingDepthSelector value="medium" labels={LABELS} ariaLabel="Effort" title="Effort" onChange={onChange} />,
    );
    fireEvent.click(container.querySelector('[data-level="smart"]') as HTMLButtonElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(onChange).toHaveBeenCalledWith('smart');
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('5');
  });

  it('drags across the rail, magnetically snaps and reports the level', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ThinkingDepthSelector value="fast" labels={LABELS} ariaLabel="Effort" title="Effort" onChange={onChange} />,
    );
    const track = container.querySelector('.ax-effort-track') as HTMLElement;
    mockTrackRect(track);

    fireEvent.pointerDown(track, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 30 });
    const dot = (level: string) => container.querySelector(`[data-level="${level}"]`) as HTMLElement;
    const thumb = container.querySelector('.ax-effort-thumb') as HTMLElement;
    // Six stops spread over 200 - 14 = 186px; dots are placed by their left
    // edge, 8px left of their centers (7 + index * 37.2).
    expect(dot('fast').style.left).toBe('-1px');
    expect(dot('smart').style.left).toBe('185px');
    // Pointer at x=30 → thumb center 30 → left edge 23.
    expect(thumb.style.left).toBe('23px');
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 190 });
    expect(onChange).toHaveBeenLastCalledWith('smart');
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 190 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(onChange).toHaveBeenLastCalledWith('smart');
  });

  it('uses content-box geometry so level stops stay inside the rail', () => {
    const { container } = render(<ThinkingDepthSelector value="fast" labels={LABELS} ariaLabel="Effort" title="Effort" />);
    const track = container.querySelector('.ax-effort-track') as HTMLElement;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 5,
      top: 0,
      right: 205,
      bottom: 24,
      width: 200,
      height: 24,
      x: 5,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(track, 'clientLeft', { configurable: true, value: 1 });
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 198 });

    fireEvent.pointerDown(track, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 16 });

    expect((container.querySelector('[data-level="fast"]') as HTMLElement).style.left).toBe('-1px');
    expect((container.querySelector('[data-level="smart"]') as HTMLElement).style.left).toBe('183px');
    // Pointer at x=16, content edge at 6 → thumb center 10 → left edge 3.
    expect((container.querySelector('.ax-effort-thumb') as HTMLElement).style.left).toBe('3px');
  });

  it('renders a canvas particle layer for the ember stream', () => {
    const { container } = render(<ThinkingDepthSelector value="medium" labels={LABELS} ariaLabel="Effort" title="Effort" />);
    expect(container.querySelector('canvas.ax-effort-canvas')).toBeTruthy();
    expect(container.querySelector('.ax-effort-thumb')).toBeTruthy();
  });
});
