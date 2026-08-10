/// <reference types="jest" />

// Verifies that the Apple and Google login/signup buttons are wired to the
// social auth coordinator (performSocialAuth) and retain their visual identity.

const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

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
});
