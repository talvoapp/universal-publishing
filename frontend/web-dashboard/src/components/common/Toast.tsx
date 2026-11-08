/**
 * Toast helpers — thin wrapper around react-hot-toast.
 */

import toast from 'react-hot-toast';

export const showToast = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  info: (message: string) => toast(message),
  loading: (message: string) => toast.loading(message),
  promise: <T,>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string },
  ) => toast.promise(promise, messages),
  dismiss: (id?: string) => toast.dismiss(id),
};

export { Toaster } from 'react-hot-toast';