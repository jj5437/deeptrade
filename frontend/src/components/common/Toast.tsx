import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/utils/cn';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  type: ToastType;
  message: string;
  duration?: number;
  onClose: () => void;
}

const toastIcons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info
};

const toastStyles = {
  success: 'bg-green-500/90 dark:bg-green-600/90 border-green-600',
  error: 'bg-red-500/90 dark:bg-red-600/90 border-red-600',
  warning: 'bg-yellow-500/90 dark:bg-yellow-600/90 border-yellow-600',
  info: 'bg-blue-500/90 dark:bg-blue-600/90 border-blue-600'
};

export function Toast({ type, message, duration = 3000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const Icon = toastIcons[type];

  useEffect(() => {
    const showTimer = setTimeout(() => setIsVisible(true), 10);
    const closeTimer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(closeTimer);
    };
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  return (
    <div
      className={cn(
        'fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-sm border transition-all duration-300',
        'max-w-md transform',
        toastStyles[type],
        isVisible && !isExiting ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-95'
      )}
    >
      <Icon className="w-5 h-5 text-white flex-shrink-0" />
      <p className="text-white font-medium flex-1">{message}</p>
      <button
        onClick={handleClose}
        className="text-white/80 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

interface ToastManagerProps {
  toasts: Array<{
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
  }>;
  removeToast: (id: string) => void;
}

export function ToastManager({ toasts, removeToast }: ToastManagerProps) {
  return (
    <>
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          style={{ top: `${16 + index * 80}px` }}
          className="fixed right-4 z-50"
        >
          <Toast
            type={toast.type}
            message={toast.message}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        </div>
      ))}
    </>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState<Array<{
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
  }>>([]);

  const showToast = (type: ToastType, message: string, duration?: number) => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const success = (message: string, duration?: number) => showToast('success', message, duration);
  const error = (message: string, duration?: number) => showToast('error', message, duration);
  const warning = (message: string, duration?: number) => showToast('warning', message, duration);
  const info = (message: string, duration?: number) => showToast('info', message, duration);

  return {
    toasts,
    showToast,
    removeToast,
    success,
    error,
    warning,
    info
  };
}
