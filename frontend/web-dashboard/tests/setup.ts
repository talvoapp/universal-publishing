/**
 * Vitest setup file.
 *
 * Extends expect with jest-dom matchers.
 */

import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});