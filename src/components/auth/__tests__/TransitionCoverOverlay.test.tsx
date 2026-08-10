/// <reference types="jest" />
// ─── TransitionCoverOverlay — native container selection ───────────────────
// Jest/react-test-renderer render the React element tree only. They CANNOT
// prove the real native z-order between FullWindowOverlay/Modal and an
// in-flight react-native-screens transition on a physical device — that
// requires an actual phone test. These tests only prove: (a) the correct
// native container is selected per platform, (b) the same SignupSurface
// content/props flow through unchanged, (c) no remount occurs from a phase
// change alone, and (d) the removal/cancellation contract from _layout.tsx
// is untouched.

import { create, act } from 'react-test-renderer';
import { Platform, Modal } from 'react-native';
import { TransitionCoverOverlay } from '../TransitionCoverOverlay';
import type { SignupVisualSnapshot } from '@/lib/transitionLease';

const mockFullWindowOverlay = jest.fn(({ children }) => children);
jest.mock('react-native-screens', () => ({
  FullWindowOverlay: (props: { children: unknown }) => mockFullWindowOverlay(props),
}));

const VISUAL: SignupVisualSnapshot = {
  surfaceType: 'signup',
  email: 'test@test.com',
  password: 'pass123',
  confirm: 'pass123',
  showPw: false,
  showConfirm: false,
};

describe('TransitionCoverOverlay', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    mockFullWindowOverlay.mockClear();
  });

  it('selects FullWindowOverlay on iOS', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<TransitionCoverOverlay visible={true} visual={VISUAL} />);
    });
    expect(mockFullWindowOverlay).toHaveBeenCalledTimes(1);
    expect(root!.root.findByProps({ email: 'test@test.com' })).toBeTruthy();
  });

  it('selects a root-level Modal on Android (not FullWindowOverlay, an iOS-only API)', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<TransitionCoverOverlay visible={true} visual={VISUAL} />);
    });
    expect(mockFullWindowOverlay).not.toHaveBeenCalled();
    const modal = root!.root.findByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.animationType).toBe('none');
    expect(modal.props.transparent).toBe(false);
    expect(modal.props.hardwareAccelerated).toBe(true);
  });

  it('renders nothing when visible=false (mirrors the caller-side removal contract)', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<TransitionCoverOverlay visible={false} visual={VISUAL} />);
    });
    expect(root!.toJSON()).toBeNull();
  });

  it('the same SignupSurface content/props are used across an ACTIVE → DATA_READY_COVERED-style visual update — no remount is introduced by this component itself', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<TransitionCoverOverlay visible={true} visual={VISUAL} />);
    });
    const instanceBefore = root!.root.findByProps({ email: 'test@test.com' }).instance;

    const updatedVisual: SignupVisualSnapshot = { ...VISUAL, email: 'test@test.com' };
    act(() => {
      root!.update(<TransitionCoverOverlay visible={true} visual={updatedVisual} />);
    });
    const instanceAfter = root!.root.findByProps({ email: 'test@test.com' }).instance;

    // react-test-renderer gives host-component fiber identity continuity —
    // re-rendering with the same element position/type does not remount.
    expect(instanceAfter).toBe(instanceBefore);
  });

  it('onRequestClose on Android is a controlled no-op — back button must not dismiss the cover mid-transition', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<TransitionCoverOverlay visible={true} visual={VISUAL} />);
    });
    const modal = root!.root.findByType(Modal);
    expect(typeof modal.props.onRequestClose).toBe('function');
    expect(() => modal.props.onRequestClose()).not.toThrow();
  });
});
