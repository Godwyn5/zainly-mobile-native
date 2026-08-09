/// <reference types="jest" />

// Verifies that the Apple and Google login/signup buttons have NOT been modified
// by checking that the key strings and handlers still exist in the source files.

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

  it('login-methods.tsx still shows "Bientôt disponible" alert for Apple', () => {
    const content = fs.readFileSync(loginMethodsPath, 'utf-8');
    expect(content).toContain('Bientôt disponible');
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

  it('signup-methods.tsx still shows "Bientôt disponible" alert for Apple', () => {
    const content = fs.readFileSync(signupMethodsPath, 'utf-8');
    expect(content).toContain('Bientôt disponible');
  });
});
