/// <reference types="jest" />

// Verifies that the Apple and Google login/signup buttons are wired to the
// social auth coordinator (performSocialAuth) and retain their visual identity.

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('Apple and Google auth buttons — unchanged', () => {
  const loginMethodsPath = path.resolve(__dirname, '../../../app/(auth)/login-methods.tsx');
  const signupMethodsPath = path.resolve(__dirname, '../../../app/(auth)/signup-methods.tsx');

  it('login-methods.tsx still has Apple button with "Continuer avec Apple"', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).toContain('Continuer avec Apple');
    expect(content).toContain('handleApple');
    expect(content).toContain('AppleIcon');
    expect(content).toContain('appleButton');
  });

  it('login-methods.tsx still has Google button with "Continuer avec Google"', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).toContain('Continuer avec Google');
    expect(content).toContain('handleGoogle');
    expect(content).toContain('GoogleIcon');
  });

  it('login-methods.tsx wires Apple button to performSocialAuth', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).toContain('performSocialAuth');
    expect(content).toContain("handleSocial('apple')");
  });

  it('signup-methods.tsx still has Apple button with "Continuer avec Apple"', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).toContain('Continuer avec Apple');
    expect(content).toContain('handleApple');
    expect(content).toContain('AppleIcon');
    expect(content).toContain('appleButton');
  });

  it('signup-methods.tsx still has Google button with "Continuer avec Google"', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).toContain('Continuer avec Google');
    expect(content).toContain('handleGoogle');
    expect(content).toContain('GoogleIcon');
  });

  it('signup-methods.tsx wires Apple button to performSocialAuth', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).toContain('performSocialAuth');
    expect(content).toContain("handleSocial('apple')");
  });

  // ── No placeholder text ──
  it('login-methods.tsx does not contain "Bientôt disponible" placeholder', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).not.toMatch(/bient[oô]t disponible/i);
    expect(content).not.toMatch(/coming soon/i);
  });

  it('signup-methods.tsx does not contain "Bientôt disponible" placeholder', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).not.toMatch(/bient[oô]t disponible/i);
    expect(content).not.toMatch(/coming soon/i);
  });

  // ── Apple button hidden on non-iOS ──
  it('login-methods.tsx gates Apple button on Platform.OS === ios', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).toContain("Platform.OS === 'ios'");
  });

  it('signup-methods.tsx gates Apple button on Platform.OS === ios', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).toContain("Platform.OS === 'ios'");
  });

  // ── Double-tap blocking via socialLoading ──
  it('login-methods.tsx blocks both social buttons during any social loading', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).toContain('socialLoading');
    expect(content).toContain('loading.apple || socialLoading');
    expect(content).toContain('loading.google || socialLoading');
  });

  it('signup-methods.tsx blocks both social buttons during any social loading', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).toContain('socialLoading');
    expect(content).toContain('loading.apple || socialLoading');
    expect(content).toContain('loading.google || socialLoading');
  });

  // ── Honest config_error handling ──
  it('login-methods.tsx handles config_error with honest message', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).toContain("'config_error'");
    expect(content).toContain('Configuration manquante');
  });

  it('signup-methods.tsx handles config_error with honest message', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).toContain("'config_error'");
    expect(content).toContain('Configuration manquante');
  });

  // ── Unavailable handling ──
  it('login-methods.tsx handles unavailable reason', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).toContain("'unavailable'");
  });

  it('signup-methods.tsx handles unavailable reason', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).toContain("'unavailable'");
  });

  // ── Email button unchanged ──
  it('login-methods.tsx still has email button routing to login-email', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).toContain('handleEmail');
    expect(content).toContain('login-email');
  });

  it('signup-methods.tsx still has email button routing to signup-email', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).toContain('handleEmail');
    expect(content).toContain('signup-email');
  });
});
