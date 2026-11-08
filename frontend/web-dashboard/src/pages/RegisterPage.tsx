/**
 * Register page — sign up form.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { showToast } from '@/components/common/Toast';
import { registerSchema } from '@/utils/validation';

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const loading = useAuthStore((s) => s.loading);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Client validation
    const result = registerSchema.safeParse({ email, password, displayName });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path[0];
        if (typeof path === 'string') fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    try {
      await register({ email, password, displayName });
      showToast.success('Account created! Welcome.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-600 text-white text-xl font-bold mb-3">
            U
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
          <p className="text-sm text-slate-600 mt-1">Start writing and publishing today</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Display name"
              type="text"
              autoComplete="name"
              placeholder="Jane Doe"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              error={errors.displayName}
              required
              autoFocus
            />
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              required
            />
            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              hint="Must contain at least 8 characters, one letter and one digit"
              required
            />

            <Button type="submit" loading={loading} fullWidth size="lg">
              Create account
            </Button>
          </form>

          <p className="mt-4 text-xs text-slate-500 text-center">
            By signing up, you agree to our{' '}
            <Link to="/terms" className="text-brand-600 hover:underline">Terms</Link>
            {' '}and{' '}
            <Link to="/privacy" className="text-brand-600 hover:underline">Privacy Policy</Link>
          </p>

          <div className="mt-6 text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-600 hover:text-brand-700 font-medium">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}