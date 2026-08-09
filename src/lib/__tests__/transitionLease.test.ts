/// <reference types="jest" />
import {
  createTransitionLease,
  releaseTransitionLease,
  forceReleaseTransitionLease,
  hasActiveTransitionLease,
  getActiveTransitionLeaseFlowId,
  getActiveTransitionLeaseUserId,
  setTransitionLeaseUserId,
  subscribeToTransitionLease,
  completeTransitionLease,
  signalDashboardReady,
  clearTransitionLease,
  getLeaseSnapshot,
  type SignupVisualSnapshot,
} from '../transitionLease';

const VISUAL: SignupVisualSnapshot = {
  surfaceType: 'signup',
  email: 'test@test.com',
  password: 'pass123',
  confirm: 'pass123',
  showPw: false,
  showConfirm: false,
};

describe('transitionLease', () => {
  afterEach(() => {
    forceReleaseTransitionLease();
  });

  it('hasActiveTransitionLease returns false when no lease is active', () => {
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('createTransitionLease makes hasActiveTransitionLease return true', () => {
    const leaseId = createTransitionLease('flow-123');
    expect(hasActiveTransitionLease()).toBe(true);
    expect(getActiveTransitionLeaseFlowId()).toBe('flow-123');
    expect(leaseId).toContain('flow-123');
  });

  it('createTransitionLease throws if a lease is already active', () => {
    createTransitionLease('flow-123');
    expect(() => createTransitionLease('flow-456')).toThrow('already active');
  });

  it('releaseTransitionLease deactivates the lease when leaseId matches', () => {
    const leaseId = createTransitionLease('flow-123');
    releaseTransitionLease(leaseId);
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('releaseTransitionLease does nothing when leaseId does not match', () => {
    createTransitionLease('flow-123');
    releaseTransitionLease('wrong-id');
    expect(hasActiveTransitionLease()).toBe(true);
  });

  it('forceReleaseTransitionLease always deactivates', () => {
    createTransitionLease('flow-123');
    forceReleaseTransitionLease();
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('setTransitionLeaseUserId sets the userId on the active lease', () => {
    createTransitionLease('flow-123');
    expect(getActiveTransitionLeaseUserId()).toBeNull();
    setTransitionLeaseUserId('user-A');
    expect(getActiveTransitionLeaseUserId()).toBe('user-A');
  });

  it('subscribeToTransitionLease fires on create and release', () => {
    const listener = jest.fn();
    const unsub = subscribeToTransitionLease(listener);
    expect(listener).not.toHaveBeenCalled();

    createTransitionLease('flow-123');
    expect(listener).toHaveBeenCalledTimes(1);

    forceReleaseTransitionLease();
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
  });

  it('getActiveTransitionLeaseFlowId returns null when no lease is active', () => {
    expect(getActiveTransitionLeaseFlowId()).toBeNull();
  });
});

describe('atomic transition (ACTIVE → DATA_READY_COVERED → DASHBOARD_READY → IDLE)', () => {
  afterEach(() => {
    forceReleaseTransitionLease();
  });

  it('completeTransitionLease atomically transitions to data_ready_covered', () => {
    const leaseId = createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');

    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);

    const snapshot = getLeaseSnapshot();
    expect(snapshot.phase).toBe('data_ready_covered');
    expect(snapshot.userId).toBe('user-A');
    expect(snapshot.flowId).toBe('flow-123');
    expect(snapshot.leaseId).toBe(leaseId);
    expect(snapshot.sessionGen).toBe('gen-1');
    expect(snapshot.cacheVerified).toBe(true);
    expect(snapshot.visual).toEqual(VISUAL);
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('completeTransitionLease is a single notification', () => {
    const leaseId = createTransitionLease('flow-123');
    const listener = jest.fn();
    subscribeToTransitionLease(listener);
    listener.mockClear();

    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('completeTransitionLease does nothing if leaseId does not match', () => {
    createTransitionLease('flow-123');
    completeTransitionLease('wrong-id', 'user-A', 'flow-123', 'gen-1', VISUAL);
    expect(getLeaseSnapshot().phase).toBe('active');
  });

  it('completeTransitionLease does nothing if phase is not active', () => {
    const leaseId = createTransitionLease('flow-123');
    releaseTransitionLease(leaseId);
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    expect(getLeaseSnapshot().phase).toBe('idle');
  });

  it('signalDashboardReady promotes to dashboard_ready', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    const ok = signalDashboardReady(leaseId, 'flow-123', 'user-A', 'gen-1');
    expect(ok).toBe(true);
    expect(getLeaseSnapshot().phase).toBe('dashboard_ready');
  });

  it('signalDashboardReady returns false if phase is not data_ready_covered', () => {
    const leaseId = createTransitionLease('flow-123');
    const ok = signalDashboardReady(leaseId, 'flow-123', 'user-A', 'gen-1');
    expect(ok).toBe(false);
    expect(getLeaseSnapshot().phase).toBe('active');
  });

  it('signalDashboardReady returns false if userId does not match', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    const ok = signalDashboardReady(leaseId, 'flow-123', 'user-B', 'gen-1');
    expect(ok).toBe(false);
    expect(getLeaseSnapshot().phase).toBe('data_ready_covered');
  });

  it('signalDashboardReady returns false if sessionGen does not match', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    const ok = signalDashboardReady(leaseId, 'flow-123', 'user-A', 'gen-2');
    expect(ok).toBe(false);
    expect(getLeaseSnapshot().phase).toBe('data_ready_covered');
  });

  it('signalDashboardReady returns false if flowId does not match', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    const ok = signalDashboardReady(leaseId, 'flow-456', 'user-A', 'gen-1');
    expect(ok).toBe(false);
    expect(getLeaseSnapshot().phase).toBe('data_ready_covered');
  });

  it('clearTransitionLease transitions to idle from dashboard_ready', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    signalDashboardReady(leaseId, 'flow-123', 'user-A', 'gen-1');
    clearTransitionLease(leaseId);
    expect(getLeaseSnapshot().phase).toBe('idle');
  });

  it('releaseTransitionLease on error path goes directly to idle', () => {
    const leaseId = createTransitionLease('flow-123');
    releaseTransitionLease(leaseId);
    expect(getLeaseSnapshot().phase).toBe('idle');
    expect(getLeaseSnapshot().cacheVerified).toBe(false);
  });

  it('snapshot userId mismatch — matchingReadyHandoff would be false', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    const snapshot = getLeaseSnapshot();
    expect(snapshot.userId).toBe('user-A');
    expect(snapshot.userId === 'user-B').toBe(false);
  });

  it('forceReleaseTransitionLease clears everything regardless of phase', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', VISUAL);
    forceReleaseTransitionLease();
    expect(getLeaseSnapshot().phase).toBe('idle');
  });

  it('visual snapshot is stored and accessible in data_ready_covered', () => {
    const leaseId = createTransitionLease('flow-123');
    const customVisual: SignupVisualSnapshot = {
      surfaceType: 'login',
      email: 'user@test.com',
      password: 'secret',
      confirm: '',
      showPw: true,
      showConfirm: false,
    };
    completeTransitionLease(leaseId, 'user-A', 'flow-123', 'gen-1', customVisual);
    const snapshot = getLeaseSnapshot();
    expect(snapshot.visual).toEqual(customVisual);
    expect(snapshot.visual?.surfaceType).toBe('login');
  });

  it('visual snapshot is null in idle state', () => {
    expect(getLeaseSnapshot().visual).toBeNull();
  });

  it('visual snapshot is null in active state', () => {
    createTransitionLease('flow-123');
    expect(getLeaseSnapshot().visual).toBeNull();
  });
});
