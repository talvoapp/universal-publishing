/**
 * Settings page — profile, password, account deletion.
 */

import { useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { userApi } from '@/api/auth.api';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { showToast } from '@/components/common/Toast';

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const logout = useAuthStore((s) => s.logout);

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({ displayName, bio });
      showToast.success('Profile updated');
    } catch {
      showToast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPassword(true);
    try {
      await userApi.changePassword(currentPassword, newPassword);
      showToast.success('Password changed. Please sign in again.');
      setCurrentPassword('');
      setNewPassword('');
      await logout();
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await userApi.deleteAccount(deletePassword);
      showToast.success('Account deleted');
      await logout();
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-600 mt-1">Manage your account</p>
      </div>

      {/* Profile */}
      <form onSubmit={handleSaveProfile} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="font-semibold text-slate-900">Profile</h2>
        <Input
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          value={user?.email || ''}
          disabled
          hint="Contact support to change your email"
        />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg resize-none"
            placeholder="Tell readers about yourself"
            maxLength={500}
          />
          <p className="text-xs text-slate-500 mt-1">{bio.length}/500</p>
        </div>
        <Button type="submit" loading={saving}>Save changes</Button>
      </form>

      {/* Password */}
      <form onSubmit={handleChangePassword} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="font-semibold text-slate-900">Change password</h2>
        <Input
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <Input
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          hint="At least 8 characters, one letter, one digit"
          required
        />
        <Button type="submit" loading={changingPassword}>Change password</Button>
      </form>

      {/* Danger zone */}
      <div className="bg-danger-50 rounded-xl border border-danger-200 p-6">
        <h2 className="font-semibold text-danger-900">Delete account</h2>
        <p className="text-sm text-danger-700 mt-1 mb-4">
          This schedules your account for deletion. You have 30 days to recover it by contacting support.
        </p>
        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </Button>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete account?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleDeleteAccount} loading={deleting}>
              Delete account
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 mb-4">
          This action cannot be undone easily. All your drafts, wallet balance, and content will be hidden.
        </p>
        <Input
          label="Confirm password"
          type="password"
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
          placeholder="Enter your password"
          autoFocus
        />
      </Modal>
    </div>
  );
}