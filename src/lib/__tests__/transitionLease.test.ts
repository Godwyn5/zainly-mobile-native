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
  setVerifiedHandoff,
  consumeVerifiedHandoff,
  clearVerifiedHandoff,
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

describe('verifiedHandoff', () => {
  afterEach(() => {
    forceReleaseTransitionLease();
    clearVerifiedHandoff();
  });

  it('consumeVerifiedHandoff returns null when no handoff is set', () => {
    expect(consumeVerifiedHandoff('user-A')).toBeNull();
  });

  it('setVerifiedHandoff then consumeVerifiedHandoff returns the handoff for matching userId', () => {
    setVerifiedHandoff('user-A', 'flow-123');
    const handoff = consumeVerifiedHandoff('user-A');
    expect(handoff).not.toBeNull();
    expect(handoff!.userId).toBe('user-A');
    expect(handoff!.flowId).toBe('flow-123');
    expect(handoff!.handoffId).toContain('flow-123');
  });

  it('consumeVerifiedHandoff is atomic — second call returns null', () => {
    setVerifiedHandoff('user-A', 'flow-123');
    consumeVerifiedHandoff('user-A');
    expect(consumeVerifiedHandoff('user-A')).toBeNull();
  });

  it('consumeVerifiedHandoff returns null when userId does not match', () => {
    setVerifiedHandoff('user-A', 'flow-123');
    expect(consumeVerifiedHandoff('user-B')).toBeNull();
  });

  it('consumeVerifiedHandoff clears handoff even on userId mismatch (no stale bypass)', () => {
    setVerifiedHandoff('user-A', 'flow-123');
    consumeVerifiedHandoff('user-B');
    expect(consumeVerifiedHandoff('user-A')).toBeNull();
  });

  it('clearVerifiedHandoff clears any stored handoff', () => {
    setVerifiedHandoff('user-A', 'flow-123');
    clearVerifiedHandoff();
    expect(consumeVerifiedHandoff('user-A')).toBeNull();
  });
});
