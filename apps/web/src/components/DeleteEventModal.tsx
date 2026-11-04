'use client';

import { useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface DeleteEventModalProps {
  isOpen: boolean;
  eventId: string;
  eventTitle: string;
  soldTicketsCount?: number;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteEventModal({
  isOpen,
  eventId,
  eventTitle,
  soldTicketsCount = 0,
  onClose,
  onDeleted,
}: DeleteEventModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/organizer/events/${eventId}`, {
        method: 'DELETE',
      });
      onDeleted();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete event. Only the organizer who created it can delete it.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm animate-rise"
    >
      <div className="card max-w-md w-full p-6 shadow-lift space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h2 id="delete-dialog-title" className="text-lg font-bold font-display text-ink">
                Delete Event
              </h2>
              <p className="text-xs text-ink-3">This action cannot be undone</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-lg p-1 text-ink-3 hover:bg-sunken hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-ink-2">
          <p>
            Are you sure you want to delete <strong className="text-ink font-semibold">“{eventTitle}”</strong>?
          </p>
          <p className="text-xs text-ink-3 leading-relaxed">
            Once deleted, this event and its show timings will no longer be visible to users or available for booking. All seat availability and hold records will be permanently deleted.
          </p>

          {soldTicketsCount > 0 && (
            <div className="notice notice-warn">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                <strong>Warning:</strong> {soldTicketsCount} ticket{soldTicketsCount === 1 ? ' has' : 's have'} already been booked for this event. Deleting the event will delete all associated ticket and booking records.
              </span>
            </div>
          )}

          {error && (
            <p role="alert" className="notice notice-error">{error}</p>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2 border-t border-line">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="btn btn-secondary btn-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="btn btn-danger btn-sm"
          >
            <Trash2 className="h-4 w-4" />
            {isDeleting ? 'Deleting event...' : 'Delete Event'}
          </button>
        </div>
      </div>
    </div>
  );
}

