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
  commitTransitionLease,
  clearTransitionLease,
  getLeaseSnapshot,
} from '../transitionLease';

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

describe('atomic transition (ACTIVE → READY_UNACKNOWLEDGED → READY_COMMITTED → IDLE)', () => {
  afterEach(() => {
    forceReleaseTransitionLease();
  });

  it('completeTransitionLease atomically transitions to ready_unacknowledged', () => {
    const leaseId = createTransitionLease('flow-123');
    setTransitionLeaseUserId('user-A');

    completeTransitionLease(leaseId, 'user-A', 'flow-123');

    const snapshot = getLeaseSnapshot();
    expect(snapshot.phase).toBe('ready_unacknowledged');
    expect(snapshot.userId).toBe('user-A');
    expect(snapshot.flowId).toBe('flow-123');
    expect(snapshot.leaseId).toBe(leaseId);
    expect(snapshot.cacheVerified).toBe(true);
    // Lease is no longer active for routing
    expect(hasActiveTransitionLease()).toBe(false);
  });

  it('completeTransitionLease is a single notification', () => {
    const leaseId = createTransitionLease('flow-123');
    const listener = jest.fn();
    subscribeToTransitionLease(listener);
    listener.mockClear();

    completeTransitionLease(leaseId, 'user-A', 'flow-123');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('completeTransitionLease does nothing if leaseId does not match', () => {
    createTransitionLease('flow-123');
    completeTransitionLease('wrong-id', 'user-A', 'flow-123');
    expect(getLeaseSnapshot().phase).toBe('active');
  });

  it('completeTransitionLease does nothing if phase is not active', () => {
    const leaseId = createTransitionLease('flow-123');
    releaseTransitionLease(leaseId);
    completeTransitionLease(leaseId, 'user-A', 'flow-123');
    expect(getLeaseSnapshot().phase).toBe('idle');
  });

  it('commitTransitionLease promotes to ready_committed', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123');
    commitTransitionLease(leaseId);
    expect(getLeaseSnapshot().phase).toBe('ready_committed');
  });

  it('clearTransitionLease transitions to idle', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123');
    commitTransitionLease(leaseId);
    clearTransitionLease(leaseId);
    expect(getLeaseSnapshot().phase).toBe('idle');
  });

  it('releaseTransitionLease on error path goes directly to idle (no ready_unacknowledged)', () => {
    const leaseId = createTransitionLease('flow-123');
    releaseTransitionLease(leaseId);
    expect(getLeaseSnapshot().phase).toBe('idle');
    expect(getLeaseSnapshot().cacheVerified).toBe(false);
  });

  it('snapshot userId mismatch — matchingReadyHandoff would be false', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123');
    const snapshot = getLeaseSnapshot();
    // If current userId is 'user-B', the snapshot userId 'user-A' does not match
    expect(snapshot.userId).toBe('user-A');
    expect(snapshot.userId === 'user-B').toBe(false);
  });

  it('forceReleaseTransitionLease clears everything regardless of phase', () => {
    const leaseId = createTransitionLease('flow-123');
    completeTransitionLease(leaseId, 'user-A', 'flow-123');
    forceReleaseTransitionLease();
    expect(getLeaseSnapshot().phase).toBe('idle');
  });
});
