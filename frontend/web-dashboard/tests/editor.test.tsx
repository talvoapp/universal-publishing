/**
 * Basic rendering tests for common components.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Loader } from '@/components/common/Loader';

describe('Button', () => {
  it('renders with children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('applies danger variant', () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-danger-600');
  });
});

describe('Input', () => {
  it('renders label and input', () => {
    render(<Input label="Email" placeholder="you@example.com" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(<Input label="Email" error="Invalid email" />);
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
  });

  it('shows hint when no error', () => {
    render(<Input label="Email" hint="We won't spam you" />);
    expect(screen.getByText("We won't spam you")).toBeInTheDocument();
  });
});

describe('Loader', () => {
  it('renders with label', () => {
    render(<Loader label="Loading data…" />);
    expect(screen.getByText('Loading data…')).toBeInTheDocument();
  });

  it('renders page variant', () => {
    render(<Loader variant="page" label="Please wait" />);
    expect(screen.getByText('Please wait')).toBeInTheDocument();
  });
});